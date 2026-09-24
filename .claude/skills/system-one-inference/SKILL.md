---
name: system-one-inference
description: Working rules for Taste Engine's Jev / TypeSafe System One decision-inference layer. Use whenever touching src/nightlife/, src/eventEvidence.js, a provider adapter's evidence facts, the semantic insight on Music or Overview cards, or Jev telemetry. Also use when a task mentions Jev, TypeSafe, System One, the AI Gateway, Choice/Score/Noul, event evidence, or decision confidence.
---

# System One inference in Taste Engine

Full reference: `docs/system-one-inference.md`. Policy: `AGENTS.md`.
Read both before changing the contract. This file is the short version.

## The one thing to get right

**Jev is an evaluation model, not a chat model.** It takes a `state` plus typed
questions and returns typed answers with probabilities and confidence. It
generates no text.

So: never ask it for a `reason`, a summary, a headline, or any prose. Every
sentence a user reads is composed deterministically — `composeReason` in
`src/nightlife/decisionSchema.js` and the card claims in
`src/nightlife/cardInsight.js` — from typed answers and the facts actually sent.

**Typed is not the same as grounded.** Our own composition can state something
false without any model involved. The live gate caught all-day placeholder
spans rendered as "a published end time", a promoter's own name rendered as an
event classification, and taxonomy placeholders like `Undefined` shown as
facts. Before a claim says "published", check the source really published it.

## Primitives

| Type | Returns |
| --- | --- |
| `choice` | `choice`, `probabilities`, `confidence` |
| `score` | `score`, `legend`, `probabilities`, `confidence` |
| `noul` | `noul` (0–1 probability of yes) — **no confidence field** |

Native route: `POST https://api.typesafe.ai/v1/systemone`, body
`{ state, model, questions }`, response `{ model, answers, usage }`.

Vercel AI Gateway route: `POST https://ai-gateway.vercel.sh/v1/evaluate`, model
`typesafe-ai/jev`, and the yes/no primitive is named **`boolean`**, not `noul`.
The adapter translates; the domain vocabulary stays `noul`. The Gateway's
response envelope is unconfirmed until the account has a card on file.

All questions run in parallel against one state: one request per candidate,
every question for that candidate in it. Every production question is a
Choice; the adapters still translate Noul/Score, but nothing asks one.

The state is always `{ event: { ref, published, missing } }`, built by
`buildSemanticCandidateInput` from merged, permitted evidence as
`{ ref, publishedFacts, knownUnknowns }`, and nothing else. There is no request
context, and there are no canonical titles, venues, prices or travel estimates.
Every candidate with eligible evidence is assessed each refresh.
`NIGHTLIFE_MAX_CANDIDATES` (default 200) is a spend ceiling, not a shortlist;
overflow shows as `eligibleBeyondBudget` and a `partial` source-health row.

## Characterization is event-level; relevance is local

Jev characterizes the **event** from permitted event facts. It never learns who
the event is for: no artist match, discovery tier, taste tag, playlist or note
enters its state, and its cache key is event-level. Relevance to this user is
compared afterwards, locally, in `src/nightlife/personalRelevance.js`, and
only these comparisons exist:

- a distinct experience (documented festival/format, or Jev's `dance_floor` /
  `festival_multi_stage` / `seated_listening` at moderate+ certainty, grounded
  in a genre, format or lineup fact it was sent) **and** a direct artist match
  (`matchedArtists` origin `source` or `top-items`);
- a published genre **and** a recurring `tasteProfile.topTags` entry, only when
  no direct artist already explains the fit.

Both halves or nothing. A discovery path is not a preference and not proof of
novelty; `live_performance` is not a distinction; there is no format, venue or
negative preference to compare against. Never write "new to you", "you'll
love", or any claim about the user's history.

## Where the product surfaces

Enrichment lives only inside the existing **Music** and **Overview** cards: one
compact chip, an **About this night** disclosure with at most three claims
marked verified / inferred / not known, and a **How do we know?** list linking
each claim to its source. There is no standalone route, form, or score. A card
with nothing specific to say renders nothing — that is the correct outcome, not
a gap to fill.

## Composing claims

`composeInsightClaims` (in `cardInsight.js`) returns every supported claim with a
`basis`: `documented-attribute`, `model-characterization`, `calculated-match`
(plus `eventBasis`), `uncertainty` or `conflict`. The card keeps the strongest
per kind, at most three, and leads with a non-gap claim. Rules:

- Never state an absence as a fact ("no restriction is verified" is banned).
- Never restate the card: no "Music", no bare start time, no age limit already
  in the title.
- Quote a window only from one provider's own start and end.
- The displayed title may be SeatGeek's: use it only to suppress repetition or
  detect a disagreement, never as a new claim or model input.
- A model characterization, or a match resting on one, is `inferred`, never
  `verified`, and cites only facts the model was sent.

## Rules for this repo

1. **Questions come from evidence.** `buildQuestionSet` composes a per-candidate
   subset from the facts `serializeEventEvidenceForModel` marks
   model-transmittable. No eligible evidence means no questions and **no call**.
   `test/eventEvidence.test.js` guards against the serializer and composer
   drifting apart; if it fails, every request would go out empty and earn a 422.
2. **Questions live in `src/nightlife/questions.js` and nowhere else.** Adding or
   rewording one means bumping `QUESTION_SET_VERSION`, which invalidates cached
   assessments. Do not inline an instruction string in an adapter.
3. **Two routes to `unknown`, both deliberate.** Each characterization Choice
   offers an explicit `unknown` described as "the supplied facts are
   insufficient or inconclusive", so the model has an honest exit. Separately,
   any answer below the confidence floor is banded to `unknown` by
   `certaintyBand`. Neither may be rendered as a weak or negative rating.
4. **One question asks one thing.** If a judgment weighs several independent
   factors, split it and combine the results in code.
5. **Raw probabilities stay in `signals`.** They are provider-scoped diagnostics.
   Never render them, never publish them, and never compare a raw confidence
   value across providers.
6. **Deterministic code keeps authority.** Model answers never change the
   canonical utility score, Fit, Friction, Urgency, Confidence, source facts,
   publication eligibility, or the taste profile. Schedule, travel, budget and
   urgency are never asked of the model.
7. **Per-candidate fallback.** A failed or unparseable call leaves that one
   candidate unenriched; its card renders exactly as it would with inference
   off. `telemetry.coverage` reports what was assessed.

## Evidence and rights

`src/eventEvidence.js` keeps each provider's facts separately, each with its own
provenance, retrieval time, assertion kind and permission set
(`internalUse`, `display`, `modelInput`, `persist`). Display rights and model
rights are independent: Framework's descriptive copy renders but never reaches
the model. Three serializers — model input, display, internal — must stay
separate.

Only Ticketmaster and Framework are permitted evidence providers. Insomniac is
unverified and excluded until its extractor is repaired with real fixtures.

The published projection carries only `semanticInsight` (claims, status,
basis, citations): no `eventEvidence`, no `nightlifeEvidence`, no permission
metadata, no raw assessment. Local export and hosted refresh share
`toDisplayEvent` in `src/projection.js`, and a site test asserts both publish
the same fields. Full evidence, artist matches and taste tags go to the
gitignored `data/nightlife/evidence-latest.json` for evaluation only.

Never send SeatGeek-only material, Spotify Content or Spotify-derived preference
evidence, EDMTrain payloads, personal-context notes, or credentials.
`assertNoRestrictedEvidence` runs immediately before transmission in both
adapters.

## Adding a provider

Implement `evaluate({ state, questions, signal })` returning
`{ answers, usage, latencyMs, model, route }` in the neutral primitive shape,
put it in `src/nightlife/providers/`, register it in `adapterFor`, and add its
config block in `src/nightlife/config.js`. Nothing outside that directory may
branch on which provider is active. Add fixture-based contract tests covering
timeout, 429, malformed body, unrequested question id, and partial answers.

## Checks before you finish

- `npm test` passes, including `test/eventEvidence.test.js` and
  `test/nightlifePolicy.test.js`.
- `npm run evaluation:nightlife` passes (offline, no credentials), including
  the composed-insight cases in `test/fixtures/nightlife/insight-cases.js`.
  Add a case there for any new claim type or grounding defect.
- `npm run nightlife:cards` reports 0 grounding violations and attributes
  claims by basis; never count source extraction as model value.
- `npm run nightlife:probe` answers on the direct route if you touched the
  contract; it drives the real production path, so it fails when production
  would.
- Any new serializer field has a `FIELD_PROVENANCE` entry.
- Any question change bumped `QUESTION_SET_VERSION`.
- With no API key, cards render unchanged and `jev-events` source health reads
  `not configured`.
