"use client";

import { useMemo, useState } from "react";
import { eventHref } from "./event-anchor";
import { useFeedback } from "./feedback-context";
import type { PlanningInput } from "./feedback-store";
import { formatLocalDate } from "./local-date";

export type SeasonItem = {
  id: string;
  vertical: "music" | "sports";
  title: string;
  startLocal: string | null;
  venueLabel: string;
  why: string;
  score: number;
  fit: number | null;
  friction: number | null;
  urgency: string;
  confidence: string;
  call: string;
  label: string;
  groupKey: string;
  planning: PlanningInput | null;
};

const DAYS = 42;
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

// The next six weeks as one strip: every night that has something on it, how
// strong the best option is, and where your saved dates sit. It answers "what
// does the next month and a half look like" before any card is read.
export function SeasonStrip({ items, todayKey }: { items: SeasonItem[]; todayKey: string }) {
  const feedback = useFeedback();
  const days = useMemo(() => {
    const byDate = new Map<string, SeasonItem[]>();
    for (const item of items) {
      const key = String(item.startLocal ?? "").slice(0, 10);
      if (key) byDate.set(key, [...(byDate.get(key) ?? []), item]);
    }
    const start = new Date(`${todayKey}T12:00:00Z`);
    return Array.from({ length: DAYS }, (_, offset) => {
      const date = new Date(start.getTime() + offset * 86_400_000);
      const key = date.toISOString().slice(0, 10);
      const dayItems = (byDate.get(key) ?? []).sort((left, right) => right.score - left.score);
      return { key, date, weekday: date.getUTCDay(), dayOfMonth: date.getUTCDate(), items: dayItems, best: dayItems[0]?.score ?? 0 };
    });
  }, [items, todayKey]);
  const strongest = useMemo(() => days.filter((day) => day.items.length).sort((left, right) => right.best - left.best)[0]?.key ?? null, [days]);
  const [selected, setSelected] = useState<string | null>(null);
  const activeKey = selected ?? strongest;
  const active = days.find((day) => day.key === activeKey) ?? null;
  const nightsWithOptions = days.filter((day) => day.items.length).length;
  const isPlanned = (item: SeasonItem) => {
    const planning = feedback?.ready ? feedback.planningFor(item.id) : null;
    return Boolean(planning?.saved || planning?.held);
  };

  if (!nightsWithOptions) return null;
  return (
    <section className="seasonStrip" aria-label="The next six weeks">
      <div className="seasonHead">
        <p className="eyebrow">The next six weeks</p>
        <p className="seasonSummary"><b>{nightsWithOptions}</b> nights with something on · <b>{days.filter((day) => day.best >= 40).length}</b> worth a real look</p>
      </div>
      <div className="seasonDays" role="group" aria-label="Choose a night">
        {days.map((day, index) => {
          const height = day.items.length ? Math.max(10, Math.min(100, Math.round((day.best / 70) * 100))) : 0;
          const tone = day.best >= 55 ? "strong" : day.best >= 40 ? "good" : day.best >= 25 ? "some" : "faint";
          const planned = day.items.some(isPlanned);
          const monthStart = index === 0 || day.dayOfMonth === 1;
          return <button
            aria-label={`${formatLocalDate(day.key, { weekday: "long", month: "long", day: "numeric" })}: ${day.items.length ? `${day.items.length} option${day.items.length === 1 ? "" : "s"}, best ${Math.round(day.best)}` : "nothing ranked"}`}
            aria-pressed={day.key === activeKey}
            className={`seasonDay ${day.weekday === 5 || day.weekday === 6 ? "weekend" : ""} ${day.items.length ? `tone-${tone}` : "empty"}`}
            disabled={!day.items.length}
            key={day.key}
            onClick={() => setSelected(day.key)}
            type="button"
          >
            <span className="seasonMonth">{monthStart ? formatLocalDate(day.key, { month: "short" }) : ""}</span>
            <span className="seasonBarWell"><i style={{ height: `${height}%` }} />{planned ? <em aria-hidden="true" /> : null}</span>
            <span className="seasonDate">{day.dayOfMonth}</span>
            <span className="seasonWeekday">{WEEKDAY_INITIALS[day.weekday]}</span>
          </button>;
        })}
      </div>
      {active?.items.length ? <div className="seasonDetail" aria-live="polite">
        <p className="seasonDetailDate">{formatLocalDate(active.key, { weekday: "long", month: "long", day: "numeric" })}</p>
        <ul>
          {active.items.slice(0, 4).map((item) => <li key={item.id}>
            <a href={eventHref(item.id)}>
              <span className="seasonScore">{Math.round(item.score)}</span>
              <span className="seasonTitle">{item.title}{isPlanned(item) ? <small> · saved</small> : null}</span>
              <span className="seasonVenue">{item.venueLabel} · {item.label}</span>
            </a>
          </li>)}
          {active.items.length > 4 ? <li className="seasonMore">+{active.items.length - 4} more that night</li> : null}
        </ul>
      </div> : null}
    </section>
  );
}
