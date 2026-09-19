---
name: system-one-inference
description: Working rules for Taste Engine's Jev / TypeSafe System One decision-inference layer. Use whenever touching src/nightlife/, adding or changing a typed question, adding an inference provider adapter, reading Jev telemetry, or wiring the nightlife surface in site/. Also use when a task mentions Jev, TypeSafe, System One, the AI Gateway, Choice/Score/Noul, or decision confidence.
---

# System One inference in Taste Engine

Full reference: `docs/system-one-inference.md`. Policy: `AGENTS.md`.
Read both before changing the contract. This file is the short version.

## The one thing to get right

**Jev is an evaluation model, not a chat model.** It takes a `state` plus typed
questions and returns typed answers with probabilities and confidence. It
generates no text.

So: never ask it for a `reason`, a summary, a headline, or any prose. If you
find yourself writing an `instructions` string that asks for a sentence back,
stop — you are using the wrong primitive, or the wrong model. Explanations are
composed deterministically in `composeReason` (`src/nightlife/decisionSchema.js`)
from typed answers and the fields the serializer actually sent.

## Primitives

| Type | Returns |
| --- | --- |
| `choice` | `choice`, `probabilities`, `confidence` |
| `score` | `score`, `legend`, `probabilities`, `confidence` |
| `noul` | `noul` (0–1 probability of yes) — **no confidence field** |

Endpoint: `POST /v1/systemone`, body `{ state, model, questions }`, response
`{ model, answers, usage }`. All questions run in parallel against one state, so
put every question a candidate needs in a single call rather than chaining.

## Rules for this repo

1. **One question asks one thing.** If a question weighs several independent
   factors, split it and combine the results with code in `discovery.js`. Change
   a coefficient, not a prompt.
2. **Questions live in `src/nightlife/questions.js` and nowhere else.** Adding or
   rewording one means bumping `QUESTION_SET_VERSION`, which invalidates cached
   assessments. Do not inline an instruction string in an adapter.
3. **Low confidence becomes `unknown`.** Never offer `unknown` as a Choice option
   — the model would pick it for the wrong reasons. Band the confidence instead
   (`certaintyBand`). `unknown` and "poor fit" are different answers and the UI
   shows them differently.
4. **Raw probabilities stay in `signals`.** They are provider-scoped diagnostics
   for the shadow evaluation. Never render them as calibrated cross-provider
   probabilities, and never compare a raw confidence value across providers.
5. **Deterministic layer keeps authority.** Model answers never change the
   canonical utility score, source facts, publication eligibility, or the taste
   profile. Schedule, travel, overlap, and window feasibility are recomputed in
   `itinerary.js` regardless of what any answer said.
6. **Per-candidate fallback.** A failed or unparseable call leaves that candidate
   uncovered and deterministic discovery answers for it. One bad candidate never
   fails the request; `telemetry.coverage` reports what was and was not assessed.

## Source policy, briefly

Never send SeatGeek-only material, Spotify Content or Spotify-derived preference
evidence, EDMTrain payloads, personal-context notes, or credentials. Title,
venue, exact start time and price are quoted only from an independently
permitted provider (Ticketmaster, Framework, Insomniac).

Enforcement lives in `src/nightlife/semanticInput.js`: a field allowlist with
declared provenance per field, plus `assertNoRestrictedEvidence` run immediately
before transmission in both adapters. If you add a field to the serializer you
must add its provenance entry, or it throws — that is deliberate.

Withheld evidence is omitted and named in `knownUnknowns`. It is never converted
into a negative signal.

## Adding a provider

Implement `evaluate({ state, questions, signal })` returning
`{ answers, usage, latencyMs, model, route }` in the neutral primitive shape,
put it in `src/nightlife/providers/`, register it in `adapterFor`, and add its
config block in `src/nightlife/config.js`. Nothing outside that directory may
branch on which provider is active. Add fixture-based contract tests covering
timeout, 429, malformed body, unrequested question id, and partial answers.

## Checks before you finish

- `npm test` passes, including `test/nightlifePolicy.test.js`.
- Any new serializer field has a `FIELD_PROVENANCE` entry.
- Any question change bumped `QUESTION_SET_VERSION`.
- `NIGHTLIFE_INFERENCE_PROVIDER=disabled` still produces a working deterministic
  shortlist.
