import assert from "node:assert/strict";
import test from "node:test";
import { NightlifeInputError, nightlifeStatus, runNightlifeQuery } from "../server/nightlife.ts";

const NOW = new Date("2026-09-26T12:00:00");

function event(id, { source = "ticketmaster", hour = 22, utility = 70, restricted = false } = {}) {
  const startLocal = `2026-09-26T${String(hour).padStart(2, "0")}:00:00`;
  return {
    id,
    title: `Show ${id}`,
    startLocal,
    timeTbd: false,
    eventType: "concert",
    venue: { name: `Venue ${id}`, city: "Los Angeles" },
    sources: [source],
    sourceLinks: [{ source, url: `https://${source}.com/e/${id}` }],
    matchedArtists: [{ origin: "similar" }],
    ticketObservation: { lowestPriceUsd: 30 },
    ranking: { utility },
    // Provenance decided at export time, exactly as the pipeline writes it.
    nightlifeEvidence: restricted
      ? { restricted: true, provider: null, title: null, venueName: null, city: null, venuePoint: null, namedPerformerCount: 0, advertisedPriceUsd: null, adjacentEvidence: [] }
      : {
        restricted: false,
        provider: source,
        title: `Show ${id}`,
        venueName: `Venue ${id}`,
        city: "Los Angeles",
        venuePoint: { lat: 34.043, lon: -118.24 },
        namedPerformerCount: 1,
        advertisedPriceUsd: 30,
        adjacentEvidence: ["similar"],
      },
  };
}

function withProvider(value, run) {
  const prior = process.env.NIGHTLIFE_INFERENCE_PROVIDER;
  process.env.NIGHTLIFE_INFERENCE_PROVIDER = value;
  return (async () => {
    try {
      return await run();
    } finally {
      if (prior === undefined) delete process.env.NIGHTLIFE_INFERENCE_PROVIDER;
      else process.env.NIGHTLIFE_INFERENCE_PROVIDER = prior;
    }
  })();
}

test("renders a deterministic shortlist when inference is disabled", async () => {
  await withProvider("disabled", async () => {
    const result = await runNightlifeQuery([event("a"), event("b", { utility: 45 })], {
      goal: "Something late downtown",
      date: "2026-09-26",
      earliestStart: "19:00",
      latestReturn: "03:00",
      startArea: "Downtown / Arts District",
      lateNightIntent: "out late",
    }, { now: NOW });

    assert.equal(result.stayHome, false);
    assert.equal(result.shortlist.length, 2);
    assert.equal(result.inference.status, "not configured");
    assert.equal(result.shortlist[0].inferenceCovered, false);
    assert.equal(result.shortlist[0].score, result.shortlist[0].deterministicUtility);
  });
});

test("the response carries no raw probabilities or provider errors", async () => {
  await withProvider("disabled", async () => {
    const result = await runNightlifeQuery([event("a")], {
      goal: "Anything",
      date: "2026-09-26",
      earliestStart: "19:00",
    }, { now: NOW });
    const serialized = JSON.stringify(result);
    // Raw signals and per-call telemetry are server-side diagnostics only.
    assert.ok(!serialized.includes("signals"));
    assert.ok(!serialized.includes("probabilities"));
    assert.ok(!serialized.includes("telemetry"));
    assert.equal(result.telemetry, undefined);
  });
});

test("a restricted-source candidate is never named in the response", async () => {
  await withProvider("disabled", async () => {
    const result = await runNightlifeQuery([event("sg", { source: "seatgeek", restricted: true, utility: 80 })], {
      goal: "Anything",
      date: "2026-09-26",
      earliestStart: "19:00",
    }, { now: NOW });
    const entry = result.shortlist[0];
    assert.equal(entry.restrictedSource, true);
    assert.equal(entry.title, null);
    assert.equal(entry.venue, null);
    assert.ok(!JSON.stringify(result).includes("Show sg"));
  });
});

test("a criteria revision returns which dimensions moved", async () => {
  await withProvider("disabled", async () => {
    const first = await runNightlifeQuery([event("a")], {
      goal: "Late night downtown",
      date: "2026-09-26",
      earliestStart: "19:00",
      lateNightIntent: "flexible",
    }, { now: NOW });

    const revised = await runNightlifeQuery([event("a")], {
      lateNightIntent: "out very late",
      previous: { context: first.context, refIndex: first.refIndex },
    }, { now: NOW });

    assert.deepEqual(revised.revision.changed, ["lateNightIntent"]);
    assert.equal(revised.revision.reassessAll, false);
    assert.equal(revised.context.lateNightIntent, "out very late");
    // The rest of the context survives the revision.
    assert.equal(revised.context.goal, "Late night downtown");
  });
});

test("a budget-only revision needs no re-assessment", async () => {
  await withProvider("disabled", async () => {
    const first = await runNightlifeQuery([event("a")], { goal: "Anything", date: "2026-09-26", earliestStart: "19:00" }, { now: NOW });
    const revised = await runNightlifeQuery([event("a")], {
      budgetUsd: 25,
      previous: { context: first.context, refIndex: first.refIndex },
    }, { now: NOW });
    assert.equal(revised.revision.deterministicOnly, true);
    // $30 entry is over a $25 budget, so it is excluded deterministically.
    assert.equal(revised.shortlist.length, 0);
    assert.match(revised.excluded[0].reason, /over the \$25 budget/);
  });
});

test("an invalid window is a 400-shaped input error, not a crash", async () => {
  await withProvider("disabled", async () => {
    await assert.rejects(
      () => runNightlifeQuery([event("a")], { goal: "x", date: "2026-09-26", earliestStart: "21:00", latestReturn: "20:00" }, { now: NOW }),
      NightlifeInputError,
    );
  });
});

test("status names the route without exposing a credential", async () => {
  await withProvider("direct", async () => {
    const prior = process.env.TYPESAFE_AI_API_KEY;
    process.env.TYPESAFE_AI_API_KEY = "super-secret";
    try {
      const status = nightlifeStatus();
      assert.equal(status.provider, "direct");
      assert.equal(status.configured, true);
      assert.ok(!JSON.stringify(status).includes("super-secret"));
    } finally {
      if (prior === undefined) delete process.env.TYPESAFE_AI_API_KEY;
      else process.env.TYPESAFE_AI_API_KEY = prior;
    }
  });
});
