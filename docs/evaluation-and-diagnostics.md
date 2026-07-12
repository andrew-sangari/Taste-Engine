# Evaluation and build diagnostics

Taste Engine has an offline evaluation path for the deterministic pipeline. It uses the synthetic corpus in `test/fixtures/evaluation/corpus.json` and freezes `America/Los_Angeles` plus the fixture clock. Generated and retrieval timestamps are normalized only for comparison; event dates, ranking order, lineup order, and Overview/Plan Ahead order remain meaningful.

Commands:

- `npm test` runs the root suite without credentials or network access.
- `npm run evaluation:fixtures -- --json` runs the fixture pipeline with deterministic model fallback. Use `--model valid`, `timeout`, `malformed`, `unsupported`, or `ranking-mutation` to exercise model paths. Use `--output <path>` to write a normalized comparison projection.
- `npm run projection:diff -- before.json after.json` prints a human report followed by machine-readable JSON. `--json-out <path>` writes pure JSON, and `--max-added`, `--max-removed`, and `--max-count-change` configure material-change thresholds.
- `npm run taste:explain -- --event-id <canonical-id>` reads the private build report and prints a summarized deterministic trace.
- `npm run build:site` remains the explicit live refresh/build path. It does not publish or promote a site.

The private report is `data/taste/build-report.json`. It contains sanitized source, resolution, ranking, model-pass, timing, and candidate-trace summaries. It is not copied into `site/app/data/upcoming.json` or the built site artifact. The public projection remains schema v5; diagnostics add no public fields.

The golden fixture signature is stored in `test/fixtures/evaluation/golden-summary.json`. Updating it is an intentional test change and requires explaining the fixture delta.
