# System One inference (Jev)

Reference for the decision-inference layer added for contextual nightlife
discovery. Read this before changing anything under `src/nightlife/`.

Verified against <https://docs.typesafe.ai> on 2026-09-19. Everything marked
**unverified** below needs a live credential to confirm.

## Revised product contract: source-grounded card enrichment

The original PR introduced an opt-in Tonight form, a parallel nightlife
ranking surface, and a default two-stop plan. The product revision does not
ship those surfaces. Jev is now an optional advisory layer inside the existing
Music and Overview cards. The canonical event identity, utility, rank, hassle,
urgency, confidence, links, and actions remain the existing deterministic
contracts.

The collapsed card may add one restrained, source-backed experiential chip or
sentence. An expanded “About this night” view may show at most the one to three
most consequential points: what kind of experience the event offers, why it
may fit the permitted preference representation, what is worth planning
around, and the concrete evidence or logistics gap to check. Each displayed
claim carries source URL, retrieval time, and a `verified`, `inferred`, or
`not known` state. If the assessment has no specific useful information, the
card renders no enrichment. Raw probabilities, question labels, provider
health, and a second user-facing score do not belong on the card.

There is no default request form or invented “kind of night.” Do not silently
assume a Saturday, late return, party size, transport mode, or personal goal.
Use the existing profile and event facts. If a personal preference signal is
not permitted as model input, compare it locally or omit the comparison and
say that personal fit was not assessed from the available evidence. “Build a
night around this,” nearby-event selection, and automatic itineraries are
future exploration actions, not part of this layer.

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

The original shadow implementation used four `choice` questions and three
`noul` questions per candidate. Version 2 replaces that broad,
request-dependent set with an evidence-dependent subset defined in
`src/nightlife/questions.js`. The legacy shape remains available only through
an explicit diagnostic-harness option and is not used by card enrichment.

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

## Evidence-dependent questions

The revised contract has two layers. Layer A is profile-independent event
characterization and is cacheable across cards and users: live performance,
DJ/dance program, seated listening, festival or social-led format; documented
genres; documented dance-versus-listening format; published doors/start/end;
age or entry policy; and other explicit program traits. Layer B is the
limited relevance of those characteristics to the existing fit, format
appeal, novelty, and nonnumeric friction vocabulary. Layer B may use only a
declared, independently permissible preference representation. It must never
receive Spotify playlist content, artist affinities, feedback or personal
context notes, or a synthetic `goal` invented for the request.

Build an `EventEvidence` record before the flattened display projection. Each
fact retains its value, field, provider, source event ID, canonical URL,
retrieved-at time, assertion kind (`published-fact`, `descriptive-copy`, or
`derived-estimate`), confidence, and field-level permissions for internal use,
display, model input, and persistence. A display-safe field is not
automatically model-safe. Keep conflicting provider facts and withheld fields
explicit; missing evidence is `unknown`, never a negative.

Use Jev only for narrow, evidence-supported ambiguity. A question should be
omitted when its required facts are absent rather than asked against an empty
state. Do not ask Jev to recompute clock arithmetic, timezone conversion,
travel, overlap, budget, ticket urgency, or a published end time. A late-night
claim requires an actual event end or an explicitly permitted event/venue
schedule; a late start or DJ label alone is not evidence of after-hours
viability. Novelty must come from a supported event trait and a permitted
comparison, not from a discovery tier or venue stereotype. Do not infer group
coordination without a known party. Every composed sentence must cite the
allowed evidence that was actually transmitted.

Version cache keys and the decision contract independently for event evidence,
permitted preference context, question criteria, provider/model route, and
response schema. An event characterization may be reused across Music and
Overview, but user-specific relevance must never leak through that cache.

## Source policy (this does not change)

`AGENTS.md` governs. Jev is an AI/ML model like any other:

- **Never** send SeatGeek-only API materials or Spotify Content / Spotify-derived
  preference evidence. A SeatGeek-only candidate contributes coarse derived
  timing and nothing else.
- EDMTrain payloads and lineup provenance are not model input.
- Private personal-context notes, feedback notes, and credentials are not model
  input.
- A candidate's title, venue, exact start time, and price are quoted only when an
  independently permitted, functioning provider (currently Ticketmaster or
  Framework) supplied that occurrence. Insomniac is eligible only after its
  separate repair gate passes.
- Insomniac extraction is currently **unavailable/unverified**. Until a real
  permitted fixture, failure state, and end-to-end candidate test establish a
  working parser, Insomniac contributes no discovery coverage or model
  evidence. Never fill its missing lineup, genre, venue, or end time by guess.

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

## Revision phases and offline quality gate

The follow-up is intentionally staged:

1. **Grounded baseline:** record Insomniac as unavailable, sample a small
   source-diverse set, measure which fields are present and which are allowed
   for display or model input, and define the smallest enhancement location in
   Music and Overview.
2. **Source-aware evidence:** add the minimal field-level evidence contract,
   audit actual Ticketmaster and Framework response fields and rights, preserve
   old projections, and keep source health honest. Add no provider merely to
   make Jev sound more certain.
3. **Question redesign:** replace broad `context_fit` and inferred friction
   with atomic, evidence-dependent characterization questions; retain explicit
   unknowns and deterministic ownership of schedule, travel, budget, and
   urgency. Version the contract and cache keys.
4. **Card integration:** progressively disclose one to three useful,
   source-linked insights inside the existing EventCard/LocalTake and Overview
   entry. Bound or cache enrichment; do not fan out on every render. Keep raw
   assessment telemetry in diagnostics.
5. **Product evaluation:** compare baseline and enriched cards on useful new
   information, source support, unsupported or overconfident claims, rights,
   no-op behavior, latency, spend, and unchanged canonical order. A semantic
   ranking activation is a separate reviewed change with rollback evidence.

The deterministic Phase E gate is runnable without credentials or network:

```text
node scripts/evaluate-nightlife-enrichment.js
node --test test/nightlifeEnrichmentEvaluation.test.js
```

The 24-case fixture at
`test/fixtures/nightlife/enrichment-gold.json` covers Ticketmaster,
Framework, merged Ticketmaster/SeatGeek and Framework/SeatGeek occurrences,
SeatGeek-only restricted records, sparse/display-only evidence, conflicting
providers, and unavailable Insomniac states. The report records useful
enrichment rate, source-supported claims, unsupported and overconfident claims,
rights violations, no-op correctness, ranking parity, and latency/spend
samples. Synthetic names and `fixture.invalid` URLs are deliberate; this gate
must not ingest private snapshots or licensed raw payloads.

### Live gate: measuring the real projection

The offline fixture proves the contract. It cannot tell you whether the sources
actually supply anything worth saying, so there is a second, credentialed gate:

```bash
npm run site:export      # writes data/nightlife/evidence-latest.json
npm run nightlife:cards  # evaluates that artifact against the live route
```

Evidence stays out of the published projection: a display row must not become a
backdoor to source material, and an old snapshot must not be treated as
inference-capable. The export therefore writes the full field-level evidence to
`data/nightlife/evidence-latest.json`, inside the gitignored private `data/`
directory, and the live gate reads that. It changes no ranking, projection, or
publication state.

**Measured on the 2026-09-20 projection (83 candidates, `jev-1.13.0`):**

| Measure | Result |
| --- | --- |
| Candidates with permitted evidence | 58 / 83 |
| Candidates with model-transmittable evidence | 58 / 83 |
| Cards gaining a specific claim | 37 / 83 |
| Cards rendering nothing new | 46 |
| Candidates eligible for a question | 8 |
| Candidates assessed by the model | 8 |
| Claims total / carrying a source link | 77 / 77 |
| Claims verified / inferred / not known | 39 / 1 / 37 |
| Latency | 195ms median, 289ms worst |
| Spend | $0.00032 total, $0.00004 per assessed candidate |

Field coverage is the real constraint. `title` and `venueInfo` reach 58
candidates, `startTime` 44, `classification` and `namedLineup` 38, but
`endTime` only 9 and `description` 13 — and description is display-only, so its
model-eligible count is 0. That separation is deliberate and is what the
`modelInput` permission exists to express.

The honest reading: **most of the value so far comes from extracting evidence
that was already being discarded, not from the model.** Only 8 of 83 candidates
carried enough transmittable evidence to be worth a question. Adding provider
coverage for end times, doors, age policy and event format would move this
number far more than any question-set tuning would.

### Grounding defects found by the live gate

Running the gate against real data immediately surfaced three composed claims
that were true of our data structures and false about the world. All three are
fixed, and each has a regression test in `test/eventEvidence.test.js`.

- **All-day listings were being read as a published schedule.** The Events
  Calendar fills a listing with no published clock time with a
  `00:00:00`–`23:59:59` span. Fourteen Framework events were rendering
  "a published end time (11:59 PM) makes the event window concrete". The
  adapter now honours the `all_day` flag, infers it from an exact one-day span
  when the flag is absent, rejects end-of-day and same-day-midnight sentinels,
  and marks such listings `timeTbd`.
- **A promoter tag was being published as an event classification.** Framework
  tags every event in its own calendar with the category `Framework`, which
  produced "Published classification: Framework" on twenty cards. Classification
  values matching the provider's own name are now dropped.
- **Taxonomy placeholders were being shown as facts.** Ticketmaster writes
  `Undefined` for an unset subgenre, and its `type`/`subType` values
  (`Event Style`, `Individual`, `Group`) name the taxonomy rather than the
  event. These are filtered, and a classification that only restates the
  vertical — "Music" on a music card — renders nothing at all.

This is the concrete form of the rule that typed is not the same as grounded.
None of these came from the model; every one came from our own composition of
fields the source never meant that way. Enrichment dropped from 57 cards to 37
as a result, which is the correct direction: a truthful no-op beats confident
filler.

### The harness is development-only

No shipped page calls `/api/nightlife`. The route and `server/nightlife.ts`
remain as a manual inference harness for tuning, gated on
`TASTE_ENGINE_ENV` being `local` or `test`, and return 404 anywhere else so a
deployed environment exposes no second surface. The standalone Tonight
explorer component and its styles are deleted.

