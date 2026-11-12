"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { eventHref } from "./event-anchor";
import { useFeedback } from "./feedback-context";
import type { PlanningInput } from "./feedback-store";
import { daysFromLocalDate, formatLocalDate } from "./local-date";

export type RadarContact = {
  id: string;
  sector: "music" | "sports" | "film";
  title: string;
  startLocal: string | null;
  venueLabel: string;
  why: string;
  score: number;
  label: string;
  groupKey: string;
  href: string;
  planning: PlanningInput | null;
};

type Blip = RadarContact & { days: number; angle: number; radius: number; saved: boolean };
type Filter = "all" | "music" | "sports" | "film" | "saved";

// Bearings, clockwise from twelve o'clock. Music owns most of the dial; games
// and films each get a wedge. An act keeps the same bearing for every date it
// plays, so a run of shows reads as a spoke pointing out into the calendar.
const SECTORS: Record<RadarContact["sector"], { from: number; to: number; label: string }> = {
  music: { from: 205, to: 455, label: "Music" },
  sports: { from: 100, to: 150, label: "Games" },
  film: { from: 155, to: 200, label: "Film" },
};
const RINGS = [{ days: 7, label: "1 wk" }, { days: 14, label: "2 wk" }, { days: 30, label: "1 mo" }, { days: 90, label: "3 mo" }, { days: 180, label: "6 mo" }];
const HORIZON = 180;
const SWEEP_MS = 16_000;
const TAU = Math.PI * 2;

// The next six months as a radar: today at the centre, every ranked night a
// contact. Distance is how soon, brightness and size are how well it fits,
// a ring means you saved it. The sweep is decoration; everything it shows is
// also in the contact list beside it, which is the keyboard path.
export function Radar({ contacts, todayKey }: { contacts: RadarContact[]; todayKey: string }) {
  const feedback = useFeedback();
  const [filter, setFilter] = useState<Filter>("all");
  const [squelch, setSquelch] = useState(15);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const geometry = useRef({ size: 0, cx: 0, cy: 0, R: 0 });
  const planning = feedback?.ready ? feedback.store.planning : null;

  const blips = useMemo<Blip[]>(() => contacts.flatMap((contact) => {
    const days = daysFromLocalDate(contact.startLocal, `${todayKey}T12:00:00Z`);
    if (days == null || days < 0 || days > HORIZON) return [];
    const sector = SECTORS[contact.sector];
    const bearing = sector.from + (0.06 + 0.88 * hashUnit(contact.groupKey)) * (sector.to - sector.from);
    const plan = planning?.[contact.id];
    return [{
      ...contact,
      days,
      angle: ((bearing - 90) * Math.PI) / 180,
      radius: 0.1 + 0.9 * Math.sqrt(days / HORIZON),
      saved: Boolean(plan?.saved || plan?.held),
    }];
  }), [contacts, planning, todayKey]);

  const visible = useMemo(() => blips.filter((blip) => {
    if (filter === "saved") return blip.saved;
    if (filter !== "all" && blip.sector !== filter) return false;
    return blip.saved || blip.score >= squelch;
  }), [blips, filter, squelch]);
  const strongest = useMemo(() => [...visible].sort((a, b) => b.score - a.score || a.days - b.days).slice(0, 7), [visible]);
  const selected = visible.find((blip) => blip.id === (hoverId ?? selectedId)) ?? visible.find((blip) => blip.id === selectedId) ?? strongest[0] ?? null;
  // The draw loop reads the current contacts through refs so it never restarts.
  const selectedRef = useRef<string | null>(null);
  const visibleRef = useRef<Blip[]>([]);
  const hoveringRef = useRef(false);
  const redraw = useRef<() => void>(() => undefined);
  useEffect(() => {
    selectedRef.current = selected?.id ?? null;
    visibleRef.current = visible;
    redraw.current();
  }, [selected, visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !wrap || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = getComputedStyle(wrap);
    const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const palette = {
      accent: color("--accent", "#62dfc3"), bright: color("--accent-bright", "#84ecd5"),
      muted: color("--text-muted", "#7f8984"), text: color("--text-primary", "#eceeeb"), warm: color("--orange", "#d5a36f"),
    };
    let frame = 0;
    let disposed = false;

    const resize = () => {
      // The scope's content box, so sizing the canvas never resizes the scope.
      const size = Math.max(260, Math.min(wrap.clientWidth - 22, 760));
      if (Math.abs(size - geometry.current.size) < 1) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size * ratio);
      canvas.height = Math.round(size * ratio);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      geometry.current = { size, cx: size / 2, cy: size / 2, R: size / 2 - 26 };
    };

    const draw = (time: number) => {
      const { size, cx, cy, R } = geometry.current;
      context.clearRect(0, 0, size, size);
      const sweep = reduced ? -Math.PI / 2 : ((time % SWEEP_MS) / SWEEP_MS) * TAU - Math.PI / 2;

      // Range rings and their labels.
      context.lineWidth = 1;
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textBaseline = "middle";
      for (const ring of RINGS) {
        const r = R * (0.1 + 0.9 * Math.sqrt(ring.days / HORIZON));
        context.strokeStyle = "rgba(202, 218, 211, .13)";
        context.setLineDash(ring.days === HORIZON ? [] : [2, 5]);
        context.beginPath();
        context.arc(cx, cy, r, 0, TAU);
        context.stroke();
        context.fillStyle = palette.muted;
        context.textAlign = "center";
        context.fillText(ring.label.toUpperCase(), cx, cy - r - 8 < 8 ? cy - r + 10 : cy - r - 8);
      }
      context.setLineDash([]);

      // Sector boundaries and names.
      for (const sector of Object.values(SECTORS)) {
        for (const edge of [sector.from, sector.to]) {
          const a = ((edge - 90) * Math.PI) / 180;
          context.strokeStyle = "rgba(202, 218, 211, .09)";
          context.beginPath();
          context.moveTo(cx + Math.cos(a) * R * 0.1, cy + Math.sin(a) * R * 0.1);
          context.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
          context.stroke();
        }
        const mid = (((sector.from + sector.to) / 2 - 90) * Math.PI) / 180;
        context.fillStyle = palette.muted;
        context.textAlign = "center";
        context.fillText(sector.label.toUpperCase(), cx + Math.cos(mid) * (R + 14), cy + Math.sin(mid) * (R + 14));
      }

      // The sweep and its afterglow.
      if (!reduced && typeof context.createConicGradient === "function") {
        const wedge = context.createConicGradient(sweep - 1.6, cx, cy);
        wedge.addColorStop(0, "rgba(98, 223, 195, 0)");
        wedge.addColorStop(1.6 / TAU, "rgba(98, 223, 195, .22)");
        wedge.addColorStop(1.6 / TAU + 0.0001, "rgba(98, 223, 195, 0)");
        wedge.addColorStop(1, "rgba(98, 223, 195, 0)");
        context.fillStyle = wedge;
        context.beginPath();
        context.arc(cx, cy, R, 0, TAU);
        context.fill();
        context.strokeStyle = "rgba(132, 236, 213, .55)";
        context.beginPath();
        context.moveTo(cx, cy);
        context.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R);
        context.stroke();
      }

      // You, at the centre.
      context.fillStyle = palette.text;
      context.beginPath();
      context.arc(cx, cy, 3, 0, TAU);
      context.fill();

      // Contacts behave like phosphor. Each one flares as the sweep crosses its
      // bearing, then decays almost to nothing over the rest of the turn and
      // only returns on the next pass. While the pointer is over the scope the
      // floor rises so a faded contact can still be found and picked.
      const floor = reduced ? 1 : hoveringRef.current ? 0.42 : 0.045;
      for (const blip of visibleRef.current) {
        const x = cx + Math.cos(blip.angle) * blip.radius * R;
        const y = cy + Math.sin(blip.angle) * blip.radius * R;
        const strength = Math.max(0.14, Math.min(1, blip.score / 62));
        const behind = (((sweep - blip.angle) % TAU) + TAU) % TAU;
        const glow = reduced ? 1 : Math.exp(-behind / 1.25);
        const flash = reduced ? 0 : Math.max(0, 1 - behind / 0.3);
        const lit = Math.max(floor, glow);
        const size = 2.2 + strength * 6.5;
        const isSelected = blip.id === selectedRef.current;
        if (flash > 0 || isSelected) {
          context.fillStyle = `rgba(132, 236, 213, ${(isSelected ? 0.2 : 0.34 * flash * strength).toFixed(3)})`;
          context.beginPath();
          context.arc(x, y, size + 6 + flash * 9, 0, TAU);
          context.fill();
        }
        context.globalAlpha = Math.min(1, lit * (0.3 + strength * 0.7) + flash * 0.3);
        context.fillStyle = flash > 0.5 ? palette.text : blip.sector === "film" ? palette.text : blip.sector === "sports" ? palette.warm : strength > 0.75 ? palette.bright : palette.accent;
        context.beginPath();
        context.arc(x, y, size * (1 + flash * 0.25), 0, TAU);
        context.fill();
        context.globalAlpha = 1;
        if (blip.saved || isSelected) {
          // Saved and selected contacts keep a faint ring between passes.
          context.globalAlpha = isSelected ? 1 : Math.max(0.4, lit);
          context.strokeStyle = blip.saved ? palette.warm : palette.text;
          context.lineWidth = blip.saved ? 1.5 : 1;
          context.beginPath();
          context.arc(x, y, size + 4, 0, TAU);
          context.stroke();
          context.lineWidth = 1;
          context.globalAlpha = 1;
        }
      }
      if (!reduced && !disposed) frame = requestAnimationFrame(draw);
    };

    resize();
    let pending = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { resize(); if (reduced) draw(0); });
    });
    observer.observe(wrap);
    redraw.current = () => { if (reduced) draw(0); };
    frame = requestAnimationFrame(draw);
    return () => { disposed = true; cancelAnimationFrame(frame); cancelAnimationFrame(pending); observer.disconnect(); };
  }, []);

  const nearest = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    const { cx, cy, R } = geometry.current;
    let best: Blip | null = null;
    let bestDistance = 22;
    for (const blip of visible) {
      const distance = Math.hypot(cx + Math.cos(blip.angle) * blip.radius * R - px, cy + Math.sin(blip.angle) * blip.radius * R - py);
      if (distance < bestDistance) { best = blip; bestDistance = distance; }
    }
    return best;
  };

  const counts = { all: blips.length, music: 0, sports: 0, film: 0, saved: 0 } as Record<Filter, number>;
  for (const blip of blips) { counts[blip.sector] += 1; if (blip.saved) counts.saved += 1; }
  const selectedPlan = selected?.planning && feedback?.ready ? feedback.planningFor(selected.id) : null;

  return (
    <section className="radarSection" aria-label="Radar: the next six months">
      <div className="radarIntro">
        <div><p className="eyebrow">Radar · next six months</p><h2>Everything in range.</h2></div>
        <p>You are the centre. The closer a contact, the sooner it happens; the brighter and larger it flares when the sweep finds it, the better the fit. Saved dates keep a ring. An act keeps its bearing, so a run of dates lines up as a spoke.</p>
      </div>
      <div className="radarControls">
        <div className="dateFilterGroup" role="group" aria-label="Show">
          {(["all", "music", "sports", "film", "saved"] as const).map((value) => <button aria-pressed={filter === value} className={filter === value ? "filterActive" : ""} disabled={value !== "all" && !counts[value]} key={value} onClick={() => setFilter(value)} type="button">{value === "all" ? "All" : value === "saved" ? "Saved" : SECTORS[value].label} <small>{counts[value]}</small></button>)}
        </div>
        <label className="radarSquelch">Squelch
          <input aria-label="Hide contacts scoring below" max={60} min={0} onChange={(event) => setSquelch(Number(event.target.value))} step={5} type="range" value={squelch} />
          <output>{squelch ? `under ${squelch} hidden` : "everything shown"}</output>
        </label>
      </div>
      <div className="radarBody">
        <div className="radarScope" ref={wrapRef}>
          <canvas
            aria-label={`Radar showing ${visible.length} upcoming ${visible.length === 1 ? "date" : "dates"}. The same dates are listed beside it.`}
            onClick={(event) => { const hit = nearest(event); if (hit) setSelectedId(hit.id); }}
            onPointerEnter={() => { hoveringRef.current = true; }}
            onPointerLeave={() => { hoveringRef.current = false; setHoverId(null); }}
            onPointerMove={(event) => { const hit = nearest(event); setHoverId(hit?.id ?? null); event.currentTarget.style.cursor = hit ? "pointer" : "default"; }}
            ref={canvasRef}
            role="img"
          />
          {!visible.length ? <p className="radarEmpty">Nothing in range at this setting. Lower the squelch or widen the filter.</p> : null}
        </div>
        <div className="radarReadout">
          {selected ? <article className="radarContact" aria-live="polite">
            <p className="radarContactMeta"><span>{SECTORS[selected.sector].label}</span><span>{selected.label}</span><span>{selected.days === 0 ? "Today" : selected.days === 1 ? "Tomorrow" : `In ${selected.days} days`}</span></p>
            <p className="radarContactDate">{formatLocalDate(selected.startLocal, { weekday: "long", month: "long", day: "numeric" })}</p>
            <h3>{selected.title}</h3>
            {selected.venueLabel ? <p className="radarContactVenue">{selected.venueLabel}</p> : null}
            <p className="radarContactWhy">{selected.why}</p>
            <div className="radarContactActions">
              <strong>{Math.round(selected.score)}</strong>
              <a href={selected.href}>Open the card <span aria-hidden="true">→</span></a>
              {selected.planning && feedback?.ready ? <button aria-pressed={Boolean(selectedPlan?.saved)} className={selectedPlan?.saved ? "cardAction actionActive" : "cardAction"} onClick={() => feedback.setIntent(selected.planning!, "saved", !selectedPlan?.saved)} type="button">{selectedPlan?.saved ? "Remove save" : "Save"}</button> : null}
            </div>
          </article> : null}
          {strongest.length ? <div className="radarStrongest">
            <p className="eyebrow">Strongest contacts</p>
            <ol>{strongest.map((blip) => <li key={blip.id}>
              <button aria-pressed={blip.id === selected?.id} onClick={() => setSelectedId(blip.id)} type="button">
                <span className="radarListScore">{Math.round(blip.score)}</span>
                <span className="radarListTitle">{blip.title}</span>
                <span className="radarListDate">{formatLocalDate(blip.startLocal, { month: "short", day: "numeric" })}</span>
              </button>
            </li>)}</ol>
          </div> : null}
        </div>
      </div>
    </section>
  );
}

export function radarHref(sector: RadarContact["sector"], id: string) {
  return sector === "film" ? "#movies" : eventHref(id);
}

// Deterministic 0..1 from a string, so a bearing never changes between visits.
function hashUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}
