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
  "state": {
    "event": {
      "ref": "cand-1",
      "published": { "title": "...", "classification": ["Music", "Dance/Electronic"], "startTime": "..." },
      "missing": ["end-time", "closing-hours", "after-hours", "age-policy", "ticket-availability"]
    }
  },
  "model": "jev-latest",
  "questions": {
    "event_experience": {
      "type": "choice",
      "instructions": "Characterize the documented event experience using only the published event facts.",
      "criteria": { "dance_floor": "...", "live_performance": "...", "unknown": "..." }
    }
  }
}
```

Response:

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "event_experience": {
      "type": "choice",
      "choice": "dance_floor",
      "probabilities": { "dance_floor": 0.71, "live_performance": 0.2, "unknown": 0.09 },
      "confidence": 0.62
    }
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

## Personal relevance: where characterization meets taste

Layer B is implemented in `src/nightlife/personalRelevance.js` and runs
entirely on our side, after inference. Jev never sees who an event is for: its
state is `{ event: { ref, published, missing } }` built from permitted event
facts only, and even the discovery tier (`similar` / `tag` / `promoter`) was
removed from the semantic input in question-set v3. The assessment cache key is
event-level, so one characterization serves every profile, and no match is ever
written back into it. `test/nightlifeCardInsight.test.js` proves both: two
profiles share one model call, and the transmitted state contains no artist
match, tag, or origin.

The comparisons are deliberately few. Each names both halves it needs:

| Comparison | Event half | Preference half | Claim status |
| --- | --- | --- | --- |
| `familiar-artist-in-format` | a distinct experience: a documented festival classification or format, or a Jev `experienceCharacter` of `dance_floor`, `festival_multi_stage` or `seated_listening` at moderate or high certainty, grounded in a genre, format or lineup fact the model was actually sent | a direct artist match (`matchedArtists` origin `source` or `top-items`) | `verified` when the event half is documented, `inferred` when it is Jev's |
| `taste-tag-genre` | a published, informative classification | a recurring tag in the public `tasteProfile.topTags` | `verified` |

What is deliberately **not** compared:

- A `live_performance` characterization. It is what a concert listing already
  implies, so pairing it with a familiar artist says nothing new.
- A discovery path. `similar`, `tag` and `promoter` say how a candidate reached
  the shortlist; they are not proof the user likes it, and not proof a format
  would be new to them. No claim asserts novelty or history.
- Format, venue or schedule preferences. The profile holds none, so no claim
  says an event does or does not suit one.
- A "may not fit" claim. That would need a documented negative preference,
  which the profile does not have. Private personal-context notes and feedback
  are not used; feedback application stays disabled until its own review.

A tag match is used only when no direct artist explains the fit, because the
card's existing artist match already says that.

## Composing the card

`composeInsightClaims` in `src/nightlife/cardInsight.js` gathers every
supported claim with its full provenance, then `buildSemanticEventInsight`
keeps the strongest claim per kind, at most three, and leads with the
strongest non-gap claim. A gap or disagreement may accompany a useful claim
but never stands alone. Every claim has a `basis`:

- `documented-attribute` — a source published it;
- `model-characterization` — Jev characterized published facts;
- `calculated-match` — our code matched an event attribute to a preference
  signal (the claim also carries `eventBasis`);
- `uncertainty` / `conflict` — something consequential is unknown, or two
  sources disagree.

Consequence order: a personal match, then a provider disagreement (age or
time), a model-characterized experience, a documented format, a published age
limit the title does not already show, a late start with no published end, a
late published window, a classification, a plain window, doors and start.
Nothing restates what the card already shows: no "Music", no start time on its
own, no age limit already in the title. An absence is never a claim: "no
restriction is verified" was removed outright.

Rules the composer holds to:

- A window is quoted only from one provider's own start and end.
- The card's own title may come from a provider whose facts are not evidence
  (SeatGeek). It is used only to avoid repeating a restriction and to detect a
  disagreement, never as a new claim, and it is never model input.
- A permitted title that states "21+", "18 and over" or "All ages" becomes an
  `agePolicy` fact marked `derivedFrom: 'title'`. When a structured policy
  disagrees, both are kept and the card says so.

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

- Choice confidence: `>= 0.75` high, `>= 0.5` moderate, below that the
  dimension is recorded as `unknown`.

Every production question is a Choice. The adapters still translate the Noul
and Score primitives (the Gateway names Noul `boolean`), but no question uses
them since the friction set was removed.

These are starting values, not tuned ones. Tune them against the shadow
evaluation output, and re-tune whenever the pinned model version moves.

### First shadow-evaluation finding (2026-09-19, historical)

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
not in the change that introduced the layer. (Superseded: `context_fit` and
the rest of the goal-driven question set were later deleted outright; see
below.)

Raw probabilities and confidence are kept in the assessment's `signals` field
for the shadow evaluation only. They are deliberately **not** surfaced as
calibrated cross-provider numbers, and the site renders the banded
`certainty` values instead.

## Ranking authority

Jev assessments are advisory card content only. They have no surface of their
own and order nothing. They must not modify the canonical utility score, source
facts, publication eligibility, or the learned taste profile. Enrichment reads
`ranking.utility` only to spend its call budget on the most relevant eligible
candidates first. Changing that requires a separate activation review with
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

### The goal-driven harness is retired

The original goal-driven flow — a free-text "kind of night", a shortlist
scored by `context_fit`, and a two-stop itinerary — was the product the
follow-up review rejected, and its question set was replaced by the
evidence-dependent one above. After that replacement it could no longer ask the
model anything: its inputs carry no model-transmittable evidence, so every run
reported `deterministic fallback` while assessing nothing. A harness that
silently cannot infer is worse than none, so it is deleted: the Tonight explorer,
`/api/nightlife`, `site/server/nightlife.ts`, `src/nightlife/discovery.js`,
`itinerary.js`, `criteria.js`, and `npm run nightlife:shadow`.

Its context-mode plumbing is deleted too (question set v4, decision schema
v3, semantic input v3). That covers the goal-driven questions and friction
flags, `serializeContext` and `context.js`, and the request/candidate state
branch. It also covers the coarse areas, travel estimates, prices and titles
the candidate input used to carry. `buildSemanticCandidateInput` now emits
only `{ ref, publishedFacts, knownUnknowns }` from merged, permitted evidence.
Every request is `{ event: { ref, published, missing } }`.

Its job is covered by tools that exercise the real contract:
`npm run nightlife:probe` (one synthetic event through the production path),
`npm run nightlife:cards` (the real projection), and
`npm run evaluation:nightlife` (the offline gold set). If "build a night around
this" is picked up later, the deterministic itinerary logic is recoverable from
commit `03efb1c`.

### Second live gate: personal relevance (2026-09-23)

Measured with `npm run nightlife:cards` against the 2026-09-24T01:06Z export
(98 candidates, every model-eligible candidate assessed on the direct route):

| Measure | Result |
| --- | --- |
| Candidates with permitted evidence | 73 / 98 |
| Candidates with a direct artist match | 65 |
| Candidates with descriptive model facts (genre, format or lineup) | 38 |
| Both halves present | 32 |
| Assessed by Jev | 50 / 50 eligible |
| Characterized as a distinct experience (dance floor, festival, seated) | 3 |
| Direct artist **and** a distinct experience | 2 |
| Taste-profile tags available | 0 |
| Cards with an insight, baseline → revised | 43 → 43 |
| Cards with a model-derived claim | 1 |
| Cards with a personal claim | 2 |
| Grounding violations | 0 |
| Latency | 188ms median, 487ms worst |
| Spend | $0.0019 total, $0.000038 per candidate |

The pipeline works end to end: on the SIDEPIECE card, Jev's dance-floor
characterization of a published Dance/Electronic listing with a 10 PM start
meets the direct artist match and becomes "The listing points to a dance-floor
set from SIDEPIECE, who is already in your listening" (`inferred`). On Escape,
a documented festival classification meets a direct match without the model at
all (`verified`).

It is also rare, and the report says why rather than loosening the rules:

- **Jev mostly answers "live performance".** Of 50 assessed candidates, 30
  were characterized as a live performance and 17 as unknown; three were a
  distinct experience (two festivals, one dance floor). The answer varies
  slightly between runs: an earlier run the same day also characterized Kyle
  Watson 360° as a dance-floor set. A permitted listing usually carries a title, a genre and
  a start time, which is not much to characterize from.
- **Taste tags are empty.** `topTags` is derived during Last.fm expansion from
  the seed artists' genres. The current snapshot has none, so the tag
  comparison cannot fire. Fixing that is a taste-expansion change, not an
  inference change.
- **Source coverage remains the dominant bottleneck.** Only 38 of 98
  candidates carry any descriptive fact a model could characterize, and 25
  carry no permitted evidence at all.

The cards still improved where it matters for trust. Before this revision the
published projection carried "No additional entry restriction is verified" on
15 cards and the same "confirm the schedule" line on 28. Both were generic.
The first was sometimes false: `Josh Baker (21+)` is 21+. Now neither appears,
and the unknown-finish gap shows only where a late start makes it consequential
(2 cards).

The refresh no longer shortlists at all. Previously a 24-candidate cap was
filled by ranking order, and SeatGeek-only rows at the top held slots they
could never use, so only 8 candidates were assessed per refresh. Now every
candidate with model-eligible evidence is assessed (50 in this export, about
$0.002). `NIGHTLIFE_MAX_CANDIDATES` (default 200) remains as a spend ceiling;
anything past it is counted as `eligibleBeyondBudget` in source health and
makes the row `partial`.

**After the context-mode removal (question set v4).** The shared preface
used to call every event "one Los Angeles nightlife candidate for one private
person". It now reads "one Los Angeles event from its published facts". An A/B
on the same state shows the old framing was doing work the evidence was not.
SIDEPIECE went from `dance_floor` at 0.65 confidence to `unknown` at 0.37, and
Kyle Watson 360° from `dance_floor` at 0.59 to `unknown` at 0.45. The shorter
`missing` list made no consistent difference. Calling every event "nightlife"
is an assumption, not a published fact, so the neutral wording stays. The
SIDEPIECE personal claim above no longer appears. Full-coverage export after the
change: 49/49 eligible candidates assessed, $0.0019, 146ms median. One personal
claim (Escape, documented festival), zero model-derived claims, zero grounding
violations. Richer permitted evidence (format, description rights, end times)
is what would bring model-derived claims back honestly.

### Grounding defects found in the second pass

- **A SeatGeek title's "21+" was contradicted.** `Josh Baker (21+)` takes its
  display title from SeatGeek. Framework's title is "Josh Baker", and no
  structured policy exists. The composer read the absent field as "no
  additional entry restriction is verified". Absence claims are removed, and
  permitted titles are now scanned for explicit age markers. Every permitted
  title is scanned, not only the one chosen for display.
- **Ticketmaster subgenres were misapplied.** Six of eight Dance/Electronic
  events (John Summit, Bonobo, Sub Focus, Amtrac, Jason Ross) carried
  "Amapiano". Subgenre and attraction type/subType are no longer evidence,
  except under the "Event Style" branch, where the child ("Festival") is the
  event's type. That exception sits at the type level in real payloads.
- **Merged evidence was read from one provider.** The composer used a
  candidate's own `eventEvidence` when present, which is one provider's view,
  instead of merging every occurrence field by field.
- **A model inference was cited against facts it never saw.** The old composer
  supported an inferred experience with the event description. Description is
  display-only, so the model never received it. Model claims now cite only
  transmitted facts.
- **The local and hosted projections disagreed.** The local export published
  `nightlifeEvidence` and the display view of `eventEvidence` on every row,
  while the hosted refresh did not. Nothing read them. Both paths now use
  the shared `toDisplayEvent` in `src/projection.js`, which the engine bundle
  exports to the Worker. `site/tests/hosted-projection.test.mjs` asserts the
  hosted row has exactly the local row's fields.

