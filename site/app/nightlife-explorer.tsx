"use client";

import { useState } from "react";
import { formatLocalDate, formatLocalTime } from "./local-date";

type Certainty = "high" | "moderate" | "low";

type Assessment = {
  contextFit: string;
  musicAtmosphereFit: string;
  lateNightFit: string;
  novelty: string;
  frictionFlags: string[];
  certainty: Record<string, Certainty>;
  reason: string;
  evidenceRefs: string[];
  cached: boolean;
};

export type NightlifeEntry = {
  ref: string;
  id: string;
  title: string | null;
  restrictedSource: boolean;
  startLocal: string | null;
  timeTbd: boolean;
  venue: { name: string | null; city: string | null } | null;
  neighborhood: string | null;
  eventType: string;
  score: number;
  deterministicUtility: number;
  milesFromStart: number | null;
  travelMinutesEstimate: number | null;
  advertisedPriceUsd: number | null;
  assessment: Assessment | null;
  inferenceCovered: boolean;
  unknowns: string[];
  sourceLinks: Array<{ source: string; url: string }>;
};

type NightlifeResult = {
  window: { date: string | null; start: string; end: string };
  considered: { projectionCount: number; inWindowCount: number; assessedCount: number; permittedEvidenceCount: number; stayHomeThreshold: number };
  stayHome: boolean;
  stayHomeReason: string | null;
  shortlist: NightlifeEntry[];
  alternatives: NightlifeEntry[];
  excluded: Array<{ ref: string; id: string; reason: string }>;
  plan: {
    confirmed: boolean;
    feasible: boolean;
    travelMinutesTotal: number | null;
    issues: Array<{ code: string; candidateId: string }>;
    stops: Array<{ id: string; ref: string | null; title: string | null; startLocal: string | null; timeKnown: boolean; assumedEndLocal: string | null; endIsAssumed: boolean; transferMinutes: number | null }>;
  } | null;
  refIndex: Record<string, string>;
  context: Record<string, unknown>;
  inference: { status: string; provider: string; model: string | null; coverage: { requested: number; covered: number; uncovered: string[] } };
  revision: { changed: string[]; reassessAll: boolean; deterministicOnly: boolean } | null;
};

const AREAS = ["Downtown / Arts District", "Hollywood", "Silver Lake / Echo Park", "Westside", "South Bay", "San Fernando Valley", "Long Beach", "Pasadena / San Gabriel Valley"];

// Each revision is a named, explicit change to one dimension, not a fresh
// free-text prompt. That is what lets the engine re-evaluate only what moved.
const REVISIONS: Array<{ label: string; patch: Record<string, unknown> }> = [
  { label: "More electronic", patch: { preferredMusic: ["house", "techno", "electronic"] } },
  { label: "Still going after 2am", patch: { lateNightIntent: "out very late", latestReturn: "03:30" } },
  { label: "Home earlier", patch: { lateNightIntent: "home early", latestReturn: "00:30" } },
  { label: "Closer to me", patch: { transport: "walk" } },
  { label: "Lower coordination", patch: { party: "solo" } },
  { label: "Something new", patch: { noveltyAppetite: "exploratory" } },
];

// Internal dimension names never appear in user-facing copy.
const DIMENSION_LABELS: Record<string, string> = {
  goal: "what you asked for",
  preferredMusic: "the music",
  energy: "the energy",
  lateNightIntent: "how late you want to be out",
  noveltyAppetite: "how adventurous",
  party: "who you are with",
  startArea: "where you start",
  transport: "how you get around",
  budgetUsd: "budget",
  window: "the time window",
  shortlistSize: "how many results",
  maxCandidates: "how many candidates",
};

const UNKNOWN_LABELS: Record<string, string> = {
  "end-time": "end time",
  "closing-hours": "closing hours",
  "after-hours": "afters",
  lineup: "lineup",
  genre: "genre",
  "age-policy": "age policy",
  "ticket-availability": "ticket availability",
  "cover-price": "cover",
  capacity: "capacity",
  neighborhood: "neighbourhood",
};

const FRICTION_LABELS: Record<string, string> = {
  "long-travel": "Long trip",
  "late-start": "Awkward start time",
  "group-coordination": "Needs coordination",
  "schedule-unconfirmed": "Schedule unconfirmed",
  "ticket-unknown": "Tickets unknown",
  "cost-unknown": "Cover unknown",
};

export function NightlifeExplorer({ generatedAt }: { generatedAt: string }) {
  const [goal, setGoal] = useState("");
  const [date, setDate] = useState(defaultDate(generatedAt));
  const [startArea, setStartArea] = useState("");
  const [transport, setTransport] = useState("drive");
  const [lateNightIntent, setLateNightIntent] = useState("flexible");
  const [party, setParty] = useState("");
  const [budgetUsd, setBudgetUsd] = useState("");
  const [result, setResult] = useState<NightlifeResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (patch: Record<string, unknown> | null = null) => {
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = patch && result
        ? { ...patch, previous: { context: result.context, refIndex: result.refIndex } }
        : {
          goal,
          date,
          startArea: startArea || undefined,
          transport,
          lateNightIntent,
          party: party || undefined,
          budgetUsd: budgetUsd ? Number(budgetUsd) : undefined,
          earliestStart: "19:00",
          latestReturn: "02:30",
        };
      const response = await fetch("/api/nightlife", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That request could not be completed.");
      setResult(payload as NightlifeResult);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  return <section className="explorer nightlife" aria-label="Contextual nightlife discovery">
    <form className="nightlifeForm" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="nightlifeGoal">
        <span>What kind of night?</span>
        <textarea
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Saturday, start with a good music event, keep the option of staying out late, nothing that turns into a cross-town slog."
          rows={2}
          value={goal}
        />
      </label>
      <div className="nightlifeControls">
        <label className="selectControl">Date<input onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
        <label className="selectControl">Starting from
          <select onChange={(event) => setStartArea(event.target.value)} value={startArea}>
            <option value="">Not saying</option>
            {AREAS.map((area) => <option key={area} value={area}>{area}</option>)}
          </select>
        </label>
        <label className="selectControl">Getting around
          <select onChange={(event) => setTransport(event.target.value)} value={transport}>
            {["drive", "rideshare", "transit", "walk", "bike"].map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
        <label className="selectControl">Staying out
          <select onChange={(event) => setLateNightIntent(event.target.value)} value={lateNightIntent}>
            {["home early", "flexible", "out late", "out very late"].map((intent) => <option key={intent} value={intent}>{intent}</option>)}
          </select>
        </label>
        <label className="selectControl">Who with
          <select onChange={(event) => setParty(event.target.value)} value={party}>
            <option value="">Not saying</option>
            {["solo", "date", "small group", "large group"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="selectControl">Budget<input min="0" onChange={(event) => setBudgetUsd(event.target.value)} placeholder="Any" type="number" value={budgetUsd} /></label>
        <button className="nightlifeSubmit" disabled={pending} type="submit">{pending ? "Thinking…" : "Find the night"}</button>
      </div>
      <p className="nightlifeNote">Location and companions are only ever what you type here. Nothing is inferred from your device.</p>
    </form>

    {error ? <div className="emptyState"><p className="eyebrow">Could not run</p><h3>{error}</h3></div> : null}

    {result ? <>
      <InferenceBanner result={result} />

      {result.stayHome ? (
        <div className="emptyState">
          <p className="eyebrow">The honest answer</p>
          <h3>{result.stayHomeReason}</h3>
          <p>{result.considered.inWindowCount} event{result.considered.inWindowCount === 1 ? "" : "s"} fell inside that window. Staying in is a valid result.</p>
        </div>
      ) : (
        <div className="nightlifeShortlist" data-stagger="">
          {result.shortlist.map((entry, index) => <NightlifeCard entry={entry} featured={index === 0} key={entry.ref} />)}
        </div>
      )}

      {result.plan && result.plan.stops.length > 1 ? <PlanStrip plan={result.plan} /> : null}

      <div className="nightlifeRevisions" aria-label="Change the criteria">
        <span className="eyebrow">Change my criteria</span>
        <div className="nightlifeRevisionButtons">
          {REVISIONS.map((revision) => (
            <button disabled={pending} key={revision.label} onClick={() => void submit(revision.patch)} type="button">{revision.label}</button>
          ))}
        </div>
        {result.revision?.changed.length ? (
          <p className="nightlifeNote">
            Last change touched {result.revision.changed.map((name) => DIMENSION_LABELS[name] ?? name).join(", ")}
            {result.revision.deterministicOnly ? " — re-filtered without re-asking the model." : "."}
          </p>
        ) : null}
      </div>

      {result.alternatives.length ? <details className="nightlifeAlternatives">
        <summary>{result.alternatives.length} alternative{result.alternatives.length === 1 ? "" : "s"} that did not clear the bar</summary>
        <div className="nightlifeShortlist">
          {result.alternatives.map((entry) => <NightlifeCard entry={entry} featured={false} key={entry.ref} />)}
        </div>
      </details> : null}

      {result.excluded.length ? <details className="nightlifeAlternatives">
        <summary>{result.excluded.length} ruled out by your constraints</summary>
        <ul className="nightlifeExcluded">
          {result.excluded.map((entry) => <li key={entry.ref}>{entry.reason}</li>)}
        </ul>
      </details> : null}
    </> : null}
  </section>;
}

function InferenceBanner({ result }: { result: NightlifeResult }) {
  const { inference, considered } = result;
  const degraded = inference.status !== "assessed";
  return <div className={`nightlifeStatus ${degraded ? "warn" : ""}`.trim()}>
    <span aria-hidden="true" className={`led ${inference.status === "assessed" ? "" : inference.status === "partial inference" ? "partial" : "down"}`.trim()} />
    <span>
      {inference.status === "not configured"
        ? "Inference is off. This shortlist is the deterministic ranking alone."
        : inference.status === "deterministic fallback"
          ? "Inference was unavailable, so every candidate fell back to deterministic reasoning."
          : `${inference.coverage.covered} of ${inference.coverage.requested} candidates assessed${inference.coverage.uncovered.length ? `, ${inference.coverage.uncovered.length} deterministic` : ""}.`}
    </span>
    <small>
      {considered.inWindowCount} in window · {considered.permittedEvidenceCount} with nameable source evidence
      {inference.model ? ` · ${inference.model}` : ""}
    </small>
  </div>;
}

function NightlifeCard({ entry, featured }: { entry: NightlifeEntry; featured: boolean }) {
  const assessment = entry.assessment;
  return <article className={`nightlifeCard rv ${featured ? "isFeatured" : ""}`.trim()}>
    <header>
      <div className="nightlifeWhen">
        <span>{formatLocalDate(entry.startLocal, { weekday: "short", month: "short", day: "numeric" }) ?? "Date TBD"}</span>
        <strong>{entry.timeTbd ? "Time TBD" : formatLocalTime(entry.startLocal) ?? "—"}</strong>
      </div>
      <div className="nightlifeScore" title="Deterministic utility, adjusted by the assessment">
        <strong>{entry.score}</strong>
        <small>from {entry.deterministicUtility}</small>
      </div>
    </header>

    <h3>{entry.title ?? "Unnamed candidate"}</h3>
    {entry.restrictedSource ? (
      <p className="nightlifeRestricted">Only a restricted-source listing backs this one, so it cannot be named or described here.</p>
    ) : (
      <p className="nightlifeWhere">
        {[entry.venue?.name, entry.neighborhood ?? entry.venue?.city].filter(Boolean).join(" · ")}
        {entry.travelMinutesEstimate != null ? ` · ~${entry.travelMinutesEstimate} min away` : ""}
        {entry.advertisedPriceUsd != null ? ` · from $${entry.advertisedPriceUsd}` : ""}
      </p>
    )}

    {assessment ? <>
      <p className="nightlifeReason">{assessment.reason}</p>
      <div className="nightlifeDimensions">
        <Dimension certainty={assessment.certainty.contextFit} label="Fit" value={assessment.contextFit} />
        <Dimension certainty={assessment.certainty.musicAtmosphereFit} label="Sound" value={assessment.musicAtmosphereFit} />
        <Dimension certainty={assessment.certainty.lateNightFit} label="Late" value={assessment.lateNightFit} />
        <Dimension certainty={assessment.certainty.novelty} label="Novelty" value={assessment.novelty} />
      </div>
      {assessment.frictionFlags.length ? <ul className="nightlifeFriction">
        {assessment.frictionFlags.map((flag) => <li key={flag}>{FRICTION_LABELS[flag] ?? flag}</li>)}
      </ul> : null}
    </> : (
      <p className="nightlifeReason">Ranked deterministically; no assessment was available for this candidate.</p>
    )}

    {entry.unknowns.length ? (
      <p className="nightlifeUnknowns"><strong>Not known:</strong> {entry.unknowns.map((value) => UNKNOWN_LABELS[value] ?? value).join(", ")}.</p>
    ) : null}

    {entry.sourceLinks.length ? <p className="nightlifeSources">
      {entry.sourceLinks.map((link) => <a href={link.url} key={link.url} rel="noreferrer" target="_blank">{link.source}</a>)}
    </p> : null}
  </article>;
}

// An unknown dimension is rendered as a stated gap, not as a low rating: the
// distinction is the whole point of using a calibrated model.
function Dimension({ label, value, certainty }: { label: string; value: string; certainty?: Certainty }) {
  return <span className={`nightlifeDimension value-${value} certainty-${certainty ?? "low"}`}>
    <small>{label}</small>
    <strong>{value === "unknown" ? "not clear" : value}</strong>
    {certainty && value !== "unknown" ? <em>{certainty} certainty</em> : null}
  </span>;
}

function PlanStrip({ plan }: { plan: NonNullable<NightlifeResult["plan"]> }) {
  return <div className="nightlifePlan">
    <span className="eyebrow">A possible order</span>
    <ol>
      {plan.stops.map((stop) => <li key={stop.id}>
        <strong>{stop.title ?? "Unnamed candidate"}</strong>
        <span>
          {stop.timeKnown ? formatLocalTime(stop.startLocal) : "time unconfirmed"}
          {stop.transferMinutes != null ? ` · ~${stop.transferMinutes} min from the last stop` : ""}
        </span>
      </li>)}
    </ol>
    <p className="nightlifeNote">
      {plan.confirmed
        ? "Timings come from published start times; end times are assumed, not published."
        : "This is an option, not a plan. End times and closing hours are not published by any source here, and nothing is booked or held."}
    </p>
  </div>;
}

function defaultDate(generatedAt: string) {
  const base = new Date(generatedAt);
  const target = Number.isNaN(base.getTime()) ? new Date() : base;
  target.setDate(target.getDate() + ((6 - target.getDay() + 7) % 7));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}
