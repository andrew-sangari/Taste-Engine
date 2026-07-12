# Product brief

## Promise

Every week, answer one question well:

> What is genuinely worth my time this weekend—and when is staying home the better choice?

The product should feel like a trusted friend with unusually good recall, not an exhaustive events directory.

## Output

The default output is a short weekly brief:

- **Top five** ranked recommendations, not five per category.
- **Why you**, using concrete preference evidence rather than generic event copy.
- **Hassle score** (0–10), with the causes visible: travel, timing, price, venue friction, and uncertainty.
- **Ticket urgency**: buy now, watch, safe to wait, or likely unavailable.
- **Confidence**: how much is known versus inferred.
- **Negative filter**: a direct “don't waste your time this weekend” conclusion when no candidate clears the personal-value threshold.
- **One wildcard** only when it has a legible connection to existing taste.

The brief should be readable in under three minutes.

## What makes it different

Most event products optimize discovery, inventory, or transactions. Taste Engine optimizes realized personal value:

`expected enjoyment - money cost - time cost - travel friction - regret risk`

It learns from what happened after the recommendation, not only from clicks. A sold ticket is not proof of a good night; a skipped event is not necessarily a dislike.

## Core records

### Candidate

- canonical title, type, artists or participants
- start/end time and timezone
- venue, neighborhood, coordinates
- price range, fees if known, availability status
- source URLs and last-seen timestamps
- format attributes, such as IMAX, 70mm, live set, DJ set, or festival
- provenance and confidence for every important field

### Preference evidence

- subject: artist, genre, venue, neighborhood, format, price band, day/time, or event trait
- sentiment or weight
- evidence type: seeded, saved, bought, attended, reviewed, or inferred
- timestamp and decay policy
- context: solo, date, group, work night, weekend, special occasion

### Interaction

- impression, opened, saved, dismissed, purchased, attended, or could-not-attend
- reason codes where applicable
- event, timestamp, and brief version

### Post-event review

The required interaction should take under 20 seconds:

- **Worth it?** yes / mixed / no
- **Why?** artist, performance, crowd, sound, venue, price, travel, timing, companion, novelty, or other
- optional one-line note

“Could not attend” must be separate from “not worth it.” This prevents availability and logistics from being learned as taste.

## Ranking design

Keep four concepts separate in the interface:

1. **Expected worth**: predicted chance that the person will later say “worth it.”
2. **Hassle**: travel, schedule, price, venue friction, and coordination cost.
3. **Urgency**: expected cost of waiting, based on sellout risk, price movement, and event timing.
4. **Confidence**: quality and quantity of evidence.

For the first version, use a legible weighted score:

`utility = fit + venue affinity + format affinity + novelty bonus - hassle penalty`

Urgency should change the call to action, not make a mediocre event look desirable. Confidence should temper the wording, not hide uncertainty.

After roughly 50 meaningful interactions and 15–25 post-event reviews, replace hand-tuned weights with a small pairwise or logistic model. Preserve the component scores so every recommendation remains explainable.

## Negative filtering

Apply hard filters before ranking:

- excluded artists, genres, venues, promoters, or event types
- impossible calendar overlaps
- price above a hard ceiling
- travel beyond the maximum for that event class
- unacceptable start/end times
- low-confidence duplicates or canceled events

Then allow soft negatives such as disliked venue, weak support lineup, oversaturation, bad value, or excessive coordination. If nothing clears the minimum utility threshold, the brief should say so plainly and may list one “only if...” fallback.

## Source strategy

Use breadth through adapters, not a single master source:

1. **Structured event APIs** for broad coverage and stable identifiers.
2. **Direct venue and promoter calendars** for local events that aggregators miss.
3. **Spotify-derived artist watchlists and scheduled web discovery** for high-affinity candidates.
4. **Film-release metadata plus theater showtimes** for IMAX and premium formats.
5. **Manual URLs or forwarded messages** as a permanent escape hatch.

Every adapter writes the same candidate shape. Preserve source provenance, merge duplicates by time/venue/participants, and never overwrite a higher-confidence fact silently.

## Non-goals for the first version

- a public social network
- a comprehensive city guide
- fully autonomous purchases
- a conversational interface before ranking quality is proven
- an opaque embedding-only recommender
- optimizing click-through as the north-star metric

## Success criteria

For the first four weekly briefs:

- at least one recommendation per brief is saved, attended, or explicitly judged compelling
- fewer than 20% of the top-five slots are obvious misses
- every recommendation has a specific, believable “why you” explanation
- the brief takes under three minutes to scan
- post-event feedback takes under 20 seconds
- “do nothing” is an acceptable and occasionally used result

Longer term, track:

- **worth-it rate** among attended recommendations
- **top-five hit rate**: saved, purchased, or attended
- **regret rate**: attended but rated not worth it
- **coverage**: desirable events discovered before they became impractical
- **brief trust**: obvious-miss rate and explanation accuracy
- **feedback completion**, without making feedback burdensome
