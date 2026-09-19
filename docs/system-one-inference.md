# System One inference (Jev)

Reference for the decision-inference layer added for contextual nightlife
discovery. Read this before changing anything under `src/nightlife/`.

Verified against <https://docs.typesafe.ai> on 2026-09-19. Everything marked
**unverified** below needs a live credential to confirm.

## What Jev is, and why it suits this project

Jev is TypeSafe's flagship *System One* model. It is not a chat model and it is
not a text generator. You send it a **state** (the material to judge) and a map
of **typed questions**; it returns one typed answer per question, with a
probability distribution and a confidence value. Every question is evaluated in
parallel and in isolation against the same state, so adding questions costs
almost no extra latency.

This matters for Taste Engine specifically:

- **The model cannot write prose about an event, so it cannot invent a fact
  about one.** Every sentence the user reads is composed by our code in
  `composeReason` from typed answers plus fields we actually sent. The long list
  of "never claim a sellout / never invent a showtime" guards that the Ollama
  advisory passes need is structurally unnecessary here — there is no free text
  to police.
- **"I don't know" is a first-class answer.** Confidence is derived from the
  answer's probability distribution, so a flat distribution means the model is
  genuinely unsure. We turn low confidence into `unknown` rather than letting a
  coin-flip become a rating. This is exactly the behaviour `AGENTS.md` already
  demands: missing evidence is uncertainty, never negative evidence.
- **Atomic questions, combined in code.** The documented guidance is to
  decompose a broad judgment into narrow questions and weight them yourself.
  That keeps canonical ranking authority in the deterministic pipeline, which is
  the standing constraint in `AGENTS.md`.

## The three primitives

| Type | Ask | Answer |
| --- | --- | --- |
| `choice` | Pick one option from a set you define | `choice`, `probabilities`, `confidence` |
| `score` | Rate the state against ordered levels | `score` (probability-weighted, can land between levels), `legend`, `probabilities`, `confidence` |
| `noul` | Is this statement true? | `noul` (0–1 probability of yes). **No confidence value.** |

`instructions` and every `criteria` value accept a string, object, array, or
null — structured instructions are supported and encouraged when a question has
several parts.

This repo currently uses four `choice` questions and three `noul` questions per
candidate. They are defined in one place, `src/nightlife/questions.js`, and
versioned by `QUESTION_SET_VERSION`.

## The HTTP contract

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Request:

```json
{
  "state": { "request": { "goal": "..." }, "candidate": { "ref": "cand-1" } },
  "model": "jev-latest",
  "questions": {
    "context_fit": {
      "type": "choice",
      "instructions": "How well does this match the night described?",
      "criteria": { "strong": "...", "possible": "...", "poor": "..." }
    },
    "friction_travel": {
      "type": "noul",
      "instructions": "Getting there and back is a real burden.",
      "criteria": { "true": "...", "false": "..." }
    }
  }
}
```

Response:

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "context_fit": {
      "type": "choice",
      "choice": "possible",
      "probabilities": { "strong": 0.21, "possible": 0.68, "poor": 0.11 },
      "confidence": 0.64
    },
    "friction_travel": { "type": "noul", "noul": 0.18 }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

`GET /v1/models` lists the names the account may send.

### Errors

| Status | Meaning |
| --- | --- |
| 401 | Missing or invalid API key |
| 422 | Request body failed validation; the body names the offending field |
| 429 | Rate limited — back off and retry |
| 529 | Overloaded — back off and retry |

429 and 529 are retried with backoff by `src/nightlife/inference.js`; 401 and
422 are not, because retrying a malformed or unauthorized request only wastes
the budget.

## Model facts

`jev-1.13.0`, aliased by `jev-latest` and `jev-preview`.

- **Price:** \$42 per billion input tokens. Output tokens are free. A 500-token
  state costs roughly \$0.00002, so per-candidate evaluation is effectively free
  at this project's volume; the budget ceiling exists to catch a runaway loop,
  not to ration normal use.
- **Rate limits:** 250,000 tokens/second and 1,200 requests/minute, and the
  vendor notes these adjust dynamically without notice. Do not treat them as an
  SLA.
- **Context:** 64k tokens per request total; 32k for the state plus the single
  longest question.
- **Input:** text only — string, JSON object, or array of text values.
- **Data handling:** the vendor states Jev is not trained on customer requests
  or responses. The Gateway catalog reports `zdr: all` and `no_training: all`
  for this model. This does **not** relax anything in the source policy below.

An alias can move under you. The response's `model` field reports the versioned
ID that actually answered, and we record it in telemetry for exactly that
reason.

## Two routes, one contract

`src/nightlife/inference.js` exposes a single domain-facing
`assessCandidates(inputs, context, options)`. Adapters differ only in transport.

### Direct TypeSafe serving (verified, current default)

`providers/directServing.js` speaks the documented native API at
`https://api.typesafe.ai/v1/systemone`. **Verified live on 2026-09-19:**
`jev-1.13.0` answered in 150–375ms per candidate at roughly 1,650 input tokens,
about **$0.00007 per candidate**. The seven-question set returns in one call, as
the fan-out pattern predicts.

With no explicit `NIGHTLIFE_INFERENCE_PROVIDER`, the config picks this route
whenever `TYPESAFE_AI_API_KEY` is present.

### Vercel AI Gateway (secondary route)

The Gateway carries Jev as `typesafe-ai/jev`, catalogued as `type: "evaluation"`
with `supported_specifications: ["v4"]` — a distinct modality from the
`language` models, priced identically to the native API. Base URL is
`https://ai-gateway.vercel.sh/v1`.

Two differences from the native API are **confirmed against the live endpoint**:

- the route is `POST /v1/evaluate`, not `/v1/systemone`;
- the yes/no primitive is named **`boolean`**, not `noul`. The Gateway rejects
  `noul` with `Expected 'boolean' | 'choice' | 'score'`.

The adapter translates both, so the domain vocabulary stays `noul` everywhere
above the transport.

> **Blocked:** a full round trip could not be completed. The Gateway returns
> `403 customer_verification_required` — "AI Gateway requires a valid credit
> card on file to service requests" — so the *response* envelope for evaluation
> models is still unconfirmed. The adapter accepts several plausible spellings
> of the boolean probability field (`noul`, `boolean`, `probability`, `value`)
> so the first real call yields an answer rather than a validation error. Add a
> card, run `npm run nightlife:probe` with `NIGHTLIFE_INFERENCE_PROVIDER=gateway`,
> and pin the real field name in `fromGatewayAnswer`.

Using the Gateway is an inference routing decision. It is **not** a move of
Taste Engine hosting to Vercel.

Select a route with `NIGHTLIFE_INFERENCE_PROVIDER=gateway|direct|disabled`. No
module outside `src/nightlife/providers/` may branch on which one is active.

### Why no vendor SDK

`@typesafe-ai/sdk` exists and is pleasant, but the root pipeline has no runtime
dependencies and the site runs on Cloudflare Workers. Both adapters use `fetch`
against the documented REST contract, which works unchanged in both runtimes and
keeps the adapter boundary explicit. Revisit only if the REST contract stops
being sufficient.

## Source policy (this does not change)

`AGENTS.md` governs. Jev is an AI/ML model like any other:

- **Never** send SeatGeek-only API materials or Spotify Content / Spotify-derived
  preference evidence. A SeatGeek-only candidate contributes coarse derived
  timing and nothing else.
- EDMTrain payloads and lineup provenance are not model input.
- Private personal-context notes, feedback notes, and credentials are not model
  input.
- A candidate's title, venue, exact start time, and price are quoted only when an
  independently permitted provider (Ticketmaster, Framework, Insomniac) supplied
  that occurrence.

`src/nightlife/semanticInput.js` enforces this with a field-level allowlist, a
declared provenance for every emittable field, and `assertNoRestrictedEvidence`
as a defence-in-depth scan run immediately before transmission by both adapters.
Disallowed evidence is omitted and named in `knownUnknowns` — never replaced by a
negative value.

## Confidence thresholds

Defined in `src/nightlife/questions.js`:

- Choice/Score confidence: `>= 0.75` high, `>= 0.5` moderate, below that the
  dimension is recorded as `unknown`.
- Noul: `>= 0.65` raises the friction flag, `<= 0.35` clears it, and the band
  between is "not established" and raises nothing.

These are starting values, not tuned ones. Tune them against the shadow
evaluation output, and re-tune whenever the pinned model version moves.

### First shadow-evaluation finding (2026-09-19)

Across live runs, `context_fit` came back `unknown` at low certainty for nearly
every candidate, while `music_fit` and `late_night_fit` returned high certainty
on the same state. This persists after the projection was regenerated with full
per-occurrence provenance — candidates carrying a title, venue, neighbourhood
and lineup count still return `unknown` — so it is a property of the question,
not of thin evidence. That is the model behaving correctly: `context_fit` asks it
to weigh music, timing, travel, party and novelty at once, which is exactly the
kind of multi-factor question the vendor's guidance says to decompose.

The scoring already tolerates this — an `unknown` dimension contributes zero
rather than a penalty — so the shortlist is driven by the narrow questions.
The recommended next step, before any activation decision, is to **drop
`context_fit` as a question** and compose overall fit in code from the atomic
dimensions, per the composite-scoring pattern. That is a scoring change with
real blast radius, so it belongs in a tuning pass with before/after comparisons,
not in the change that introduced the layer.

Raw probabilities and confidence are kept in the assessment's `signals` field
for the shadow evaluation only. They are deliberately **not** surfaced as
calibrated cross-provider numbers, and the site renders the banded
`certainty` values instead.

## Ranking authority

Launch is shadow/advisory. Jev assessments enrich nightlife discovery and may
order the nightlife shortlist within its own surface. They must not modify the
canonical utility score, source facts, publication eligibility, or the learned
taste profile. Changing that requires a separate activation review with
traceable before/after comparisons, per issue #2 and `AGENTS.md`.
