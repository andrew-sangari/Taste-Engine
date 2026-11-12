"use client";

import { useMemo, useState } from "react";
import { connectionPaths, constellation, describeNode, findScenes, type ConstellationNode, type EvidenceGraph } from "./engine-client.js";
import { eventHref } from "./event-anchor";
import { formatLocalDate } from "./local-date";

const SIZE = 820;
const CENTER = SIZE / 2;
const RING_RADIUS = [0, 104, 204, 284] as const;
const LABEL_CHARS = 16;

// The evidence graph drawn as a star chart. You are the centre. The first ring
// is what you already like (artists you play, promoters you follow), the second
// is the nights coming up, the third is who else is on those bills and new to
// you. A line is a real relationship from the published data: plays, presents,
// shares a bill. Selecting anything lights every route between it and you.
export function Constellation({ graph }: { graph: EvidenceGraph }) {
  const view = useMemo(() => constellation(graph, { maxEvents: 40 }), [graph]);
  const scenes = useMemo(() => findScenes(graph, { maxScenes: 4 }), [graph]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const activeId = hoverId ?? selectedId;

  const layout = useMemo(() => {
    const position = new Map<string, { x: number; y: number; node: ConstellationNode }>();
    for (const node of view.nodes) {
      const radius = RING_RADIUS[node.ring];
      position.set(node.id, { x: CENTER + radius * Math.sin(node.angle), y: CENTER - radius * Math.cos(node.angle), node });
    }
    const neighbours = new Map<string, Set<string>>();
    const link = (a: string, b: string) => neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b));
    for (const edge of view.links) { link(edge.from, edge.to); link(edge.to, edge.from); }
    return { position, neighbours };
  }, [view]);

  // What lights up: the active node, everything one step from it, and, so a
  // route always reads back to the centre, the anchors of any night involved.
  const lit = useMemo(() => {
    if (!activeId) return null;
    const ids = new Set<string>([activeId, "you"]);
    for (const id of layout.neighbours.get(activeId) ?? []) {
      ids.add(id);
      const neighbour = layout.position.get(id)?.node;
      if (neighbour?.ring === 2 && layout.position.get(activeId)?.node.ring === 3) {
        for (const anchor of layout.neighbours.get(id) ?? []) if (layout.position.get(anchor)?.node.ring === 1) ids.add(anchor);
      }
    }
    return ids;
  }, [activeId, layout]);

  const readout = useMemo(() => {
    const id = selectedId ?? hoverId;
    if (!id || id === "you") return null;
    const node = layout.position.get(id)?.node;
    const described = describeNode(graph, id);
    if (!node || !described) return null;
    const paths = node.kind === "event" && node.eventId ? connectionPaths(graph, node.eventId, { maxPaths: 4 }) : [];
    return { node, described, paths };
  }, [graph, hoverId, layout, selectedId]);

  const strongest = useMemo(() => view.nodes
    .filter((node) => node.kind === "event" && node.eventId)
    .map((node) => ({ node, paths: connectionPaths(graph, node.eventId as string, { maxPaths: 4 }) }))
    .filter((entry) => entry.paths.length >= 2)
    .sort((left, right) => right.paths.length - left.paths.length || right.node.weight - left.node.weight)
    .slice(0, 8), [graph, view]);

  if (view.nodes.length <= 1) {
    return <p className="constellationEmpty">Nothing upcoming connects to your listening yet. The chart fills in as nights are announced.</p>;
  }

  return (
    <div className="constellation">
      <div className="constellationChart">
        <svg aria-label={`Constellation of ${view.nodes.filter((node) => node.kind === "event").length} upcoming nights and how each connects to you`} className={lit ? "constellationSvg hasActive" : "constellationSvg"} role="img" viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <defs>
            <radialGradient id="constellationGlow"><stop offset="0%" stopColor="rgba(98,223,195,.22)" /><stop offset="100%" stopColor="rgba(98,223,195,0)" /></radialGradient>
          </defs>
          <circle cx={CENTER} cy={CENTER} fill="url(#constellationGlow)" r={RING_RADIUS[3] + 40} />
          {[1, 2, 3].map((ring) => <circle className="constellationRing" cx={CENTER} cy={CENTER} fill="none" key={ring} r={RING_RADIUS[ring]} />)}
          <g className="constellationLinks">
            {view.links.map((edge) => {
              const from = layout.position.get(edge.from);
              const to = layout.position.get(edge.to);
              if (!from || !to) return null;
              const on = lit ? lit.has(edge.from) && lit.has(edge.to) && (edge.from === activeId || edge.to === activeId || from.node.ring === 0 || to.node.ring === 0 || (from.node.ring <= 2 && to.node.ring <= 2)) : false;
              // Bend each line toward the centre so bundles read as arcs, not a hairball.
              const mx = (from.x + to.x) / 2;
              const my = (from.y + to.y) / 2;
              const cx = mx + (CENTER - mx) * 0.28;
              const cy = my + (CENTER - my) * 0.28;
              return <path className={`constellationLink link-${edge.kind} ${on ? "isLit" : ""}`} d={`M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`} fill="none" key={`${edge.from}|${edge.to}|${edge.kind}`} strokeWidth={0.6 + edge.weight * 1.1} />;
            })}
          </g>
          <g>
            {view.nodes.map((node) => {
              const point = layout.position.get(node.id);
              if (!point) return null;
              const radius = node.ring === 0 ? 13 : node.kind === "event" ? 4 + node.weight * 7 : node.kind === "promoter" ? 7 : 2.6 + node.weight * 3.2;
              const on = lit ? lit.has(node.id) : false;
              const degrees = (node.angle * 180) / Math.PI;
              const flip = degrees > 180;
              const labelled = node.ring === 1 || node.ring === 3;
              const text = node.label.length > LABEL_CHARS ? `${node.label.slice(0, LABEL_CHARS - 1)}…` : node.label;
              return (
                <g
                  aria-label={node.ring === 0 ? "You" : `${node.label}, ${kindLabel(node)}`}
                  aria-pressed={selectedId === node.id}
                  className={`constellationNode node-${node.kind} ring-${node.ring} ${node.relation ? `rel-${node.relation}` : ""} ${on ? "isLit" : ""} ${selectedId === node.id ? "isSelected" : ""}`}
                  key={node.id}
                  onBlur={() => setHoverId(null)}
                  onClick={() => setSelectedId(selectedId === node.id || node.ring === 0 ? null : node.id)}
                  onFocus={() => setHoverId(node.id)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(selectedId === node.id || node.ring === 0 ? null : node.id); } }}
                  onMouseEnter={() => setHoverId(node.id)}
                  onMouseLeave={() => setHoverId(null)}
                  role="button"
                  tabIndex={node.ring === 2 ? 0 : -1}
                >
                  <circle cx={point.x} cy={point.y} fill="transparent" r={Math.max(radius + 5, 9)} />
                  <circle className="constellationDot" cx={point.x} cy={point.y} r={radius} />
                  {node.ring === 0 ? <text className="constellationYou" dy="4" textAnchor="middle" x={point.x} y={point.y}>YOU</text> : null}
                  {labelled ? (
                    <text
                      className="constellationLabel"
                      dy="3"
                      textAnchor={flip ? "end" : "start"}
                      transform={`rotate(${degrees - 90 + (flip ? 180 : 0)} ${point.x} ${point.y}) translate(${flip ? -(radius + 6) : radius + 6} 0)`}
                      x={point.x}
                      y={point.y}
                    >{text}</text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
        <ul aria-hidden="true" className="constellationLegend">
          <li><i className="legendDot legendDirect" />You play them</li>
          <li><i className="legendDot legendEvent" />An upcoming night</li>
          <li><i className="legendDot legendNew" />New to you</li>
          <li><i className="legendDot legendPromoter" />Promoter you follow</li>
        </ul>
      </div>

      <div className="constellationSide">
        <section aria-live="polite" className="constellationReadout">
          {readout ? (
            <>
              <p className="eyebrow">{kindLabel(readout.node)}</p>
              <h3>{readout.described.label}</h3>
              <p>{readout.described.summary}</p>
              {readout.paths.length ? (
                <ol className="constellationPaths">
                  {readout.paths.map((path, index) => <li key={index}><span style={{ width: `${Math.round(path.strength * 100)}%` }} />{path.text}</li>)}
                </ol>
              ) : null}
              {readout.described.events.length ? (
                <ul className="constellationEvents">
                  {readout.described.events.slice(0, 5).map((event) => (
                    <li key={event.id}><a href={eventHref(event.id)}>{event.title}</a><span>{formatLocalDate(event.startLocal, { month: "short", day: "numeric" })}</span></li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <>
              <p className="eyebrow">How to read it</p>
              <h3>Every line is a reason</h3>
              <p>You are the centre. Inside ring: artists you play and promoters you follow. Middle ring: upcoming nights, larger when they score higher. Outer ring: who else is on those bills. Select anything to light the routes between it and you.</p>
            </>
          )}
        </section>

        {strongest.length ? (
          <section className="constellationList">
            <p className="eyebrow">Most connected nights</p>
            <ul>
              {strongest.map(({ node, paths }) => (
                <li key={node.id}>
                  <button aria-pressed={selectedId === node.id} onClick={() => setSelectedId(selectedId === node.id ? null : node.id)} type="button">
                    <strong>{node.label}</strong>
                    <span>{paths.length} routes · {paths.map((path) => pathKind(path.kind)).filter((value, index, all) => all.indexOf(value) === index).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {scenes.length ? (
        <section className="scenes">
          <header>
            <p className="eyebrow">Scenes forming near you</p>
            <p>Clusters of upcoming nights tied to something you already like, made mostly of artists you have not played. Built from shared bills, promoters and rooms only; nothing here changes a score.</p>
          </header>
          <div className="sceneGrid">
            {scenes.map((scene) => {
              const fresh = scene.artists.filter((artist) => !artist.known && artist.relation !== "direct");
              const bridge = scene.bridges[0];
              return (
                <article className="sceneCard" key={scene.id}>
                  <h3>{scene.label}</h3>
                  <p className="sceneCounts">{scene.events.length} nights · {scene.newCount} new to you</p>
                  {bridge ? <p className="sceneBridge">Your way in: {bridgeText(bridge)}</p> : null}
                  {fresh.length ? <p className="sceneArtists">{fresh.slice(0, 6).map((artist) => artist.name).join(" · ")}{fresh.length > 6 ? ` · +${fresh.length - 6}` : ""}</p> : null}
                  <ul>
                    {[...scene.events].sort((left, right) => right.score - left.score).slice(0, 3).map((event) => (
                      <li key={event.id}><a href={eventHref(event.id)}>{event.title}</a><span>{formatLocalDate(event.startLocal, { month: "short", day: "numeric" })} · {event.score}</span></li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function kindLabel(node: ConstellationNode): string {
  if (node.kind === "event") return "Upcoming night";
  if (node.kind === "promoter") return "Promoter you follow";
  if (node.kind === "artist") return node.relation === "direct" ? "Artist you play" : node.relation === "adjacent" ? "Near your taste" : "New to you";
  return node.kind;
}

function pathKind(kind: string): string {
  return ({ artist: "an artist you play", promoter: "a promoter you follow", watchlist: "your watchlist", venue: "a room you rate", "shared-bill": "a shared bill", roster: "a followed roster" } as Record<string, string>)[kind] ?? kind.replace(/-/g, " ");
}

function bridgeText(bridge: { from: string; to: string; via: string }): string {
  if (bridge.via === "shared bill") return `${bridge.from} shares an upcoming bill with ${bridge.to}.`;
  if (bridge.via === "roster") return `${bridge.to} is on the ${bridge.from} roster.`;
  if (bridge.via === "promoter night") return `${bridge.from} is putting on ${bridge.to}.`;
  return `${bridge.from} connects to ${bridge.to} (${bridge.via}).`;
}
