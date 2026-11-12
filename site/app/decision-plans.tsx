"use client";

import { useMemo } from "react";
import { buildDecisionPlans, DEFAULT_PLAN_CONSTRAINTS, normalizePlanConstraints, planCandidates, type DecisionPlan, type PlanPick } from "./engine-client.js";
import { eventHref } from "./event-anchor";
import type { EventItem } from "./event-explorer";
import { useFeedback } from "./feedback-context";
import { feedbackForSnapshot, type PlanConstraints } from "./feedback-store";
import { formatLocalDate } from "./local-date";
import type { SeasonItem } from "./season-strip";
import type { SportsGame } from "./sports-explorer";

const WINDOWS = [14, 30, 60, 90] as const;

// From a ranked list to a decision. The ranking says how good each night is on
// its own; this solves for the best *combination* of nights inside the
// person's limits, shows two alternatives that trade something for something
// else, and says what each one leaves out and why. It re-solves in the browser
// whenever a score moves, a date is saved or passed on, or a limit changes.
// Nothing here alters a score or what is published.
export function DecisionPlans({ events, sports, items, todayKey }: {
  events: EventItem[];
  sports: SportsGame[];
  items: SeasonItem[];
  todayKey: string;
}) {
  const feedback = useFeedback();
  const ready = Boolean(feedback?.ready);
  const stored = feedback?.planConstraints ?? null;
  const constraints = useMemo(() => normalizePlanConstraints(stored ?? DEFAULT_PLAN_CONSTRAINTS), [stored]);
  const store = feedback?.ready ? feedback.store : null;
  const planning = store?.planning ?? null;
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const result = useMemo(() => {
    const candidates = planCandidates({ events, sports, now: todayKey, windowDays: constraints.windowDays });
    const pinnedIds = Object.values(planning ?? {}).filter((item) => item.saved || item.held).map((item) => item.itemId);
    // A night the person passed on is not offered back to them in a plan.
    const passed = store
      ? [...events, ...sports].filter((row) => feedbackForSnapshot(store, row.feedbackSnapshot ?? null)?.status === "lost-interest").map((row) => row.id)
      : [];
    return buildDecisionPlans({ candidates, constraints, pinnedIds, excludedIds: passed, now: todayKey });
  }, [constraints, events, planning, sports, store, todayKey]);

  const change = (patch: Partial<PlanConstraints>) => feedback?.setPlanConstraints(normalizePlanConstraints({ ...constraints, ...patch }));
  const windowLabel = constraints.windowDays === 14 ? "two weeks" : `${constraints.windowDays} days`;
  const heading = result.empty
    ? `Nothing in the next ${windowLabel} is worth a night out`
    : result.plans.length === 1 ? `One clear way to spend the next ${windowLabel}` : `${result.plans.length === 2 ? "Two" : "Three"} ways to spend the next ${windowLabel}`;

  return (
    <section aria-labelledby="plans-heading" className="plans" id="plans">
      <header className="plansHead">
        <div>
          <p className="eyebrow">Decided</p>
          <h2 id="plans-heading">{heading}</h2>
          <p className="plansLede">
            {result.worthwhileCount} of {result.consideredCount} dates clear the bar.
            {result.pinned.length ? ` Built around the ${result.pinned.length === 1 ? "night" : `${result.pinned.length} nights`} you have already claimed.` : ""}
            {result.empty ? " Staying in is a valid plan." : " Each plan obeys the same limits; they differ in what they favour."}
          </p>
        </div>
        <form className="planLimits" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>Window</span>
            <select disabled={!ready} onChange={(event) => change({ windowDays: Number(event.target.value) })} value={constraints.windowDays}>
              {WINDOWS.map((days) => <option key={days} value={days}>{days === 14 ? "2 weeks" : `${days} days`}</option>)}
            </select>
          </label>
          <label>
            <span>Nights a week</span>
            <select disabled={!ready} onChange={(event) => change({ nightsPerWeek: Number(event.target.value) })} value={constraints.nightsPerWeek}>
              {[1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label>
            <span>Budget</span>
            <span className="planBudget">
              <span aria-hidden="true">$</span>
              <input
                aria-label="Budget in dollars for the window, blank for none"
                defaultValue={constraints.budgetUsd ?? ""}
                disabled={!ready}
                inputMode="numeric"
                key={constraints.budgetUsd ?? "none"}
                onBlur={(event) => {
                  const raw = event.target.value.trim();
                  const value = raw === "" ? null : Number(raw);
                  if (value !== constraints.budgetUsd && (value == null || Number.isFinite(value))) change({ budgetUsd: value });
                }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                placeholder="none"
              />
            </span>
          </label>
          <label className="planToggle">
            <input checked={constraints.avoidBackToBack} disabled={!ready} onChange={(event) => change({ avoidBackToBack: event.target.checked })} type="checkbox" />
            <span>No back-to-back nights</span>
          </label>
          <label className="planToggle">
            <input checked={constraints.includeTrips} disabled={!ready} onChange={(event) => change({ includeTrips: event.target.checked })} type="checkbox" />
            <span>Include trips</span>
          </label>
        </form>
      </header>

      {result.pinnedConflicts.length ? (
        <p className="planConflict" role="status">
          {result.pinnedConflicts.length === 1 ? "Two dates you claimed fall on the same day" : "Some dates you claimed fall on the same day"}: {formatLocalDate(result.pinnedConflicts[0].day, { month: "short", day: "numeric" })}. Both are kept; release one to let the plan fill around it.
        </p>
      ) : null}

      {result.empty ? null : (
        <div className={`planGrid planGrid-${result.plans.length}`}>
          {result.plans.map((plan) => (
            <PlanCard
              best={plan.lens === result.plans[0].lens}
              itemById={itemById}
              key={plan.lens}
              plan={plan}
              window={result.window}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PlanCard({ plan, best, window, itemById }: {
  plan: DecisionPlan;
  best: boolean;
  window: { startDate: string; endDate: string; days: number };
  itemById: Map<string, SeasonItem>;
}) {
  const feedback = useFeedback();
  const ready = Boolean(feedback?.ready);
  const unclaimed = plan.picks.filter((pick) => !pick.pinned && itemById.get(pick.id)?.planning);
  const claimAll = () => {
    if (!feedback?.ready) return;
    for (const pick of unclaimed) {
      const planning = itemById.get(pick.id)?.planning;
      if (planning) feedback.setIntent(planning, "saved", true);
    }
  };
  const cost = plan.totals.knownCostUsd > 0 ? `$${Math.round(plan.totals.knownCostUsd)}` : null;
  const unpriced = plan.totals.unpricedCount;
  return (
    <article className={`planCard ${best ? "planCardBest" : ""}`}>
      <header>
        <p className="planLens">{plan.label}{plan.alsoLenses.length ? <span> · also {plan.alsoLenses.map(lensName).join(" and ")}</span> : null}</p>
        <p className="planTagline">{plan.tagline}</p>
      </header>
      <PlanStrip picks={plan.picks} window={window} />
      <dl className="planTotals">
        <div><dt>Nights</dt><dd>{plan.totals.nights}</dd></div>
        <div><dt>Tickets from</dt><dd>{cost ?? <small>no prices yet</small>}{cost && unpriced ? <small> + {unpriced} unpriced</small> : null}</dd></div>
        <div><dt>Total friction</dt><dd>{Math.round(plan.totals.hassle)}<small> · avg {plan.totals.nights ? plan.totals.averageHassle.toFixed(1) : "0"}/10</small></dd></div>
      </dl>
      {plan.versusBest ? <p className="planVersus">Against the first plan: {versusText(plan.versusBest)}.</p> : null}
      <ol className="planPicks">
        {plan.picks.map((pick) => <PlanPickRow itemById={itemById} key={pick.id} pick={pick} />)}
      </ol>
      {plan.gaveUp.length ? (
        <details className="planGaveUp">
          <summary>Left out: {plan.gaveUp.length}</summary>
          <ul>
            {plan.gaveUp.map((item) => (
              <li key={item.id}>
                <a href={eventHref(item.id)}>{item.title}</a>
                <span>{formatLocalDate(item.startLocal, { month: "short", day: "numeric" })} · {item.score}</span>
                <p>{item.reason.text}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {unclaimed.length ? (
        <button className="planClaim" disabled={!ready} onClick={claimAll} type="button">
          Save {unclaimed.length === 1 ? "this night" : `these ${unclaimed.length} nights`}
        </button>
      ) : plan.picks.length ? <p className="planClaimed">Every night in this plan is already saved or held.</p> : null}
      {plan.exact ? null : <p className="planInexact">Too many combinations to check them all; this is the best one found.</p>}
    </article>
  );
}

function PlanPickRow({ pick, itemById }: { pick: PlanPick; itemById: Map<string, SeasonItem> }) {
  const feedback = useFeedback();
  const planning = itemById.get(pick.id)?.planning ?? null;
  const stored = planning && feedback?.ready ? feedback.planningFor(planning.planningSnapshot.itemId) : null;
  const saved = Boolean(stored?.saved);
  const days = pick.days.length;
  return (
    <li className={`planPick planPick-${pick.vertical}`}>
      <span className="planPickDate">
        <strong>{formatLocalDate(pick.days[0], { weekday: "short" })}</strong>
        {formatLocalDate(pick.days[0], { month: "short", day: "numeric" })}
        {days > 1 ? <small>{days} days</small> : null}
      </span>
      <span className="planPickBody">
        <a href={eventHref(pick.id)}>{pick.title}</a>
        <small>{[pick.venue, pick.priceUsd != null ? `from $${Math.round(pick.priceUsd)}` : "no price yet", pick.why].filter(Boolean).join(" · ")}</small>
      </span>
      <span className="planPickScore" title="Score">{pick.score}</span>
      {planning ? (
        <button
          aria-pressed={saved}
          className="planPickSave"
          disabled={!feedback?.ready}
          onClick={() => feedback?.ready && feedback.setIntent(planning, "saved", !saved)}
          type="button"
        >{saved ? "Saved" : stored?.held ? "Held" : "Save"}</button>
      ) : null}
    </li>
  );
}

// The window as one strip of days: picks are lit, weeks are separated, so the
// shape of a plan (clustered, spread out, front-loaded) reads at a glance.
function PlanStrip({ picks, window }: { picks: PlanPick[]; window: { startDate: string; days: number } }) {
  const byDay = new Map<string, PlanPick>();
  for (const pick of picks) for (const day of pick.days) byDay.set(day, pick);
  const start = Date.parse(`${window.startDate}T12:00:00Z`);
  const cells = Array.from({ length: window.days }, (_, index) => {
    const date = new Date(start + index * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    return { key, pick: byDay.get(key) ?? null, monday: date.getUTCDay() === 1 };
  });
  const summary = picks.length
    ? picks.map((pick) => `${formatLocalDate(pick.days[0], { month: "short", day: "numeric" })}: ${pick.title}`).join("; ")
    : "No nights out";
  return (
    <div aria-label={summary} className="planStrip" role="img" style={{ gridTemplateColumns: `repeat(${window.days}, minmax(0, 1fr))` }}>
      {cells.map((cell) => (
        <span
          className={`planDay ${cell.pick ? `planDayOn planDay-${cell.pick.vertical}` : ""} ${cell.monday ? "planDayWeek" : ""}`}
          key={cell.key}
        />
      ))}
    </div>
  );
}

function lensName(lens: string): string {
  return lens === "easy" ? "the least effort" : lens === "mix" ? "the widest mix" : "the best nights";
}

function versusText(delta: { score: number; knownCostUsd: number; hassle: number; nights: number }): string {
  const signed = (value: number, unit = "") => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${unit}${Math.abs(Math.round(value))}`;
  const parts = [`${signed(delta.score)} score`];
  if (delta.nights) parts.push(`${signed(delta.nights)} ${Math.abs(delta.nights) === 1 ? "night" : "nights"}`);
  if (delta.knownCostUsd) parts.push(`${signed(delta.knownCostUsd, "$")} in known ticket prices`);
  if (delta.hassle) parts.push(`${signed(delta.hassle)} total friction`);
  return parts.join(", ");
}
