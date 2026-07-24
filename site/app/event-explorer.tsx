"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { NO_INFORMATION_ADVISORY, isGroundedAdvisory } from "./advisories";
import { CardActions, calendarInputFrom, planningInputFrom } from "./card-actions";
import type { PublicFeedbackSnapshot } from "./feedback-store";
import { FilterDisclosure } from "./filter-disclosure";
import { RecommendationVisual, type RecommendationVisual as RecommendationVisualType } from "./recommendation-visual";
import { RecommendationScore, UrgencyChip } from "./signal-texture";
import { eventAnchor } from "./event-anchor";
import { daysFromLocalDate, formatLocalDate, formatLocalTime } from "./local-date";

type LocalEnhancement = {
  personalFit?: { score: number; label: string; explanation: string };
  recommendation?: { verdict: string; explanation: string };
  urgency?: { label: string; explanation: string };
  hassle?: { score: number; explanation: string };
};

type EventItem = {
  id: string;
  title: string;
  sourceUrl: string;
  sources?: string[];
  sourceLinks?: Array<{ source: string; url: string }>;
  eventType?: "concert" | "festival" | "dj set";
  startLocal: string | null;
  timeTbd: boolean;
  venue: { name: string; city: string; state: string };
  ticketObservation: { lowestPriceUsd: number | null; listingCount: number | null };
  matchedArtists: Array<{ name: string; seedStrength: number; primary: boolean; origin?: "source" | "similar" | "tag" | "promoter" }>;
  ranking: {
    artistFit: number;
    hassleScore: number;
    hassleReasons: string[];
    hassleBreakdown?: { logistical: number; commercial: number; personalContext: number; commercialUncertain?: boolean };
    utility: number;
    confidence: string;
    urgency: string;
    whyYou: string;
  };
  localEnhancement?: LocalEnhancement | null;
  visual?: RecommendationVisualType;
  feedbackSnapshot?: PublicFeedbackSnapshot | null;
  lineupDisplay?: {
    displayTitle: string | null;
    displayShape: string;
    orderedArtists: Array<{ lineupEntryId: string; displayName: string; relation: "direct" | "adjacent" | "unknown"; billingGroupIndex: number; b2bWithNext: boolean }>;
    totalArtists: number;
    directCount: number;
    adjacentCount: number;
    ages: string | null;
    sourceUrl: string | null;
  } | null;
};

type WindowFilter = "all" | "soon" | "later";
type EventTypeFilter = "all" | "concert" | "festival" | "dj set";
type ProviderFilter = "all" | "seatgeek" | "ticketmaster" | "framework" | "insomniac";
type SortMode = "fit" | "date" | "urgency" | "hassle";

export function EventExplorer({ events, generatedAt, targetEventId = null }: { events: EventItem[]; generatedAt: string; targetEventId?: string | null }) {
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("soon");
  const [eventType, setEventType] = useState<EventTypeFilter>("all");
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("fit");
  const [lowHassleOnly, setLowHassleOnly] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (targetEventId) { setWindowFilter("all"); setShowAll(true); }
  }, [targetEventId]);

  const filtered = useMemo(() => {
    const result = events.filter((event) => {
      const daysAway = daysFromLocalDate(event.startLocal, generatedAt) ?? Number.POSITIVE_INFINITY;
      if (windowFilter === "soon" && daysAway > 30) return false;
      if (windowFilter === "later" && daysAway <= 30) return false;
      if (eventType !== "all" && (event.eventType ?? "concert") !== eventType) return false;
      if (provider !== "all" && !(event.sources ?? []).includes(provider)) return false;
      if (lowHassleOnly && event.ranking.hassleScore > 4) return false;
      if (urgentOnly && !["buy now", "watch"].includes(event.ranking.urgency)) return false;
      return true;
    });
    return result.sort(eventComparator(sortMode));
  }, [eventType, events, generatedAt, lowHassleOnly, provider, sortMode, urgentOnly, windowFilter]);

  const groups = useMemo(() => collateEvents(filtered), [filtered]);
  const visibleGroups = showAll ? groups : groups.slice(0, 8);

  return (
    <section className="explorer" aria-label="Ranked upcoming concerts">
      <div className="filterBar">
        <div className="dateFilterGroup" aria-label="Date range filter">
          {([['all', 'All dates'], ['soon', 'Next 30 days'], ['later', 'Later']] as const).map(([value, label]) => (
            <button aria-pressed={windowFilter === value} className={windowFilter === value ? "filterActive" : ""} key={value} onClick={() => { setWindowFilter(value); setShowAll(false); }} type="button">{label}</button>
          ))}
        </div>
        <FilterDisclosure count={[eventType !== "all", provider !== "all", sortMode !== "fit", urgentOnly, lowHassleOnly].filter(Boolean).length} onClear={() => { setEventType("all"); setProvider("all"); setSortMode("fit"); setUrgentOnly(false); setLowHassleOnly(false); setShowAll(false); }}>
            <label className="selectControl">Type
              <select aria-label="Music event type" onChange={(event) => { setEventType(event.target.value as EventTypeFilter); setShowAll(false); }} value={eventType}>
                <option value="all">All</option><option value="concert">Concerts</option><option value="festival">Festivals</option><option value="dj set">DJ sets</option>
              </select>
            </label>
            <label className="selectControl">Provider
              <select aria-label="Music event provider" onChange={(event) => { setProvider(event.target.value as ProviderFilter); setShowAll(false); }} value={provider}>
                <option value="all">All</option><option value="seatgeek">SeatGeek</option><option value="ticketmaster">Ticketmaster</option><option value="framework">Framework</option><option value="insomniac">Insomniac</option>
              </select>
            </label>
            <label className="selectControl">Sort
              <select aria-label="Music event sort order" onChange={(event) => { setSortMode(event.target.value as SortMode); setShowAll(false); }} value={sortMode}>
                <option value="fit">Personal fit</option><option value="date">Date</option><option value="urgency">Urgency</option><option value="hassle">Lowest hassle</option>
              </select>
            </label>
            <label className="hassleToggle"><input checked={urgentOnly} onChange={(event) => { setUrgentOnly(event.target.checked); setShowAll(false); }} type="checkbox" /><span>Urgent</span></label>
            <label className="hassleToggle"><input checked={lowHassleOnly} onChange={(event) => { setLowHassleOnly(event.target.checked); setShowAll(false); }} type="checkbox" /><span>Low hassle</span></label>
        </FilterDisclosure>
        <span className="resultCount">{showAll ? groups.length : Math.min(groups.length, 8)} of {groups.length} entries · {filtered.length} dates</span>
      </div>

      {groups.length > 0 ? (
        <div className="eventGrid" data-stagger="">
          {visibleGroups.map((group, index) => <EventCard event={group[0]} featured={index === 0 && sortMode === "fit"} key={groupKey(group[0])} occurrences={group} />)}
        </div>
      ) : (
        <div className="emptyState"><p className="eyebrow">Good filter</p><h3>Nothing clears that bar yet.</h3><p>That is a useful answer. Try widening timing, type, urgency, or hassle.</p></div>
      )}
      {groups.length > 8 ? <button className="showMore" onClick={() => setShowAll((value) => !value)} type="button">{showAll ? "Show top 8" : `Show all ${groups.length}`}</button> : null}
    </section>
  );
}

function EventCard({ event, featured, occurrences }: { event: EventItem; featured: boolean; occurrences: EventItem[] }) {
  const price = event.ticketObservation.lowestPriceUsd;
  const origin = event.matchedArtists[0]?.origin ?? "source";
  const originLabel = origin === "similar" ? "Similar artist" : origin === "tag" ? "Genre discovery" : origin === "promoter" ? "Promoter pick" : "In your rotation";
  const enhancement = event.localEnhancement;
  const lineup = event.lineupDisplay;
  const displayTitle = lineup?.displayTitle || event.title;
  const lineupPreview = lineup?.orderedArtists.filter((artist) => artist.relation !== "unknown" && !displayTitle.toLocaleLowerCase().includes(artist.displayName.toLocaleLowerCase())).slice(0, 3) ?? [];

  return (
    <article className={`eventCard rv ${featured ? "eventFeatured" : "eventCompact"}`} id={eventAnchor(event.id)}>
      <RecommendationVisual className="eventVisual" visual={event.visual} />
      <div className="eventTopline">
        <div className="eventDate"><span>{formatLocalDate(event.startLocal, { month: "short" })?.toUpperCase() ?? "TBD"}</span><strong>{formatLocalDate(event.startLocal, { day: "numeric" }) ?? "—"}</strong></div>
        <div className="eventSignals">
          <span>{event.eventType ?? "concert"}</span>
          <span className={`origin-${origin}`}>{originLabel}</span>
          <UrgencyChip urgency={event.ranking.urgency} />
        </div>
      </div>

      <div className="eventBody">
        <p className="eventPlace">{event.venue.name} · {event.venue.city} {event.sources?.length ? `· ${event.sources.map(providerLabel).join(" + ")}` : ""}</p>
        <h3>{displayTitle}</h3>
        {lineupPreview.length ? <p className="lineupPreview">Taste matches in the lineup: {lineupPreview.map((artist) => artist.displayName).join(" · ")}</p> : null}
        <p className="eventWhy">{event.ranking.whyYou}</p>
        {event.ranking.artistFit >= 55 && event.ranking.hassleScore >= 6 ? <p className="planningObstacle">Strong fit · planning obstacle: {event.ranking.hassleReasons.join(" · ") || "check logistics before committing"}.</p> : null}
        {enhancement ? <LocalTake enhancement={enhancement} /> : null}
        {lineup && lineup.totalArtists > 0 ? <LineupDetails lineup={lineup} /> : null}
      </div>

      <div className="scoreBlock"><RecommendationScore confidence={event.ranking.confidence} fit={event.ranking.artistFit} friction={event.ranking.hassleScore} score={event.ranking.utility} status={event.ranking.utility >= 55 ? "Selective" : "Watch"} urgency={event.ranking.urgency} /></div>

      {occurrences.length > 1 ? (
        <details className="occurrenceList">
          <summary>View all {occurrences.length} dates</summary>
          {collateOccurrenceRows(occurrences).map((row) => <div className="occurrenceRow" id={row.eventId === event.id ? undefined : eventAnchor(row.eventId)} key={row.key}>
            <span>{formatLocalDate(row.dateLocal, { month: "short", day: "numeric", weekday: "short" }) ?? "Date TBD"}</span>
            <span>{row.venue}</span>
            <span className="occurrenceLinks">{row.links.map((link) => <a href={link.url} key={`${link.source}|${link.url}`} rel="noreferrer" target="_blank">{providerLabel(link.source)} ↗</a>)}</span>
          </div>)}
        </details>
      ) : null}

      <div className="eventFooter">
        <div>{!event.timeTbd && formatLocalTime(event.startLocal) ? <span>{formatLocalTime(event.startLocal)}</span> : <span className="signalAbsent">Time TBD</span>}{price == null ? null : <span>From ${price}</span>}</div>
        <CardActions
          calendarEvent={calendarInputFrom({ ...event, title: displayTitle, description: event.ranking.whyYou })}
          layout="music"
          planning={planningInputFrom("music", { ...event, title: displayTitle })}
        />
        <a href={event.sourceUrl} rel="noreferrer" target="_blank">View tickets <span aria-hidden="true">↗</span></a>
      </div>
    </article>
  );
}

function LineupDetails({ lineup }: { lineup: NonNullable<EventItem["lineupDisplay"]> }) {
  const groups = new Map<number, typeof lineup.orderedArtists>();
  for (const artist of lineup.orderedArtists) groups.set(artist.billingGroupIndex, [...(groups.get(artist.billingGroupIndex) ?? []), artist]);
  return <details className="lineupDetails">
    <summary>View lineup ({lineup.totalArtists})</summary>
    <div className="lineupGroups">
      {[...groups.entries()].map(([index, artists]) => <p key={index}>{artists.map((artist) => <span className={`lineup-${artist.relation}`} key={artist.lineupEntryId}>{artist.displayName}</span>).reduce<ReactNode[]>((items, artist, artistIndex) => artistIndex ? [...items, <b aria-hidden="true" key={`sep-${index}-${artistIndex}`}> B2B </b>, artist] : [artist], [])}</p>)}
      {lineup.ages ? <p className="lineupAges">Ages: {lineup.ages}</p> : null}
      {lineup.sourceUrl ? <a href={lineup.sourceUrl} rel="noreferrer" target="_blank">Lineup via EDMTrain</a> : null}
    </div>
  </details>;
}

function LocalTake({ enhancement }: { enhancement: LocalEnhancement }) {
  const recommendation = enhancement.recommendation ?? enhancement.personalFit;
  const showLead = isGroundedAdvisory(recommendation);
  const details = [enhancement.personalFit, enhancement.urgency, enhancement.hassle].filter((entry) => entry && !NO_INFORMATION_ADVISORY.test(entry.explanation));
  if (!showLead && !details.length) return null;
  return <div className="localTake">
    <p className="eyebrow">Taste Engine note</p>
    {showLead && recommendation ? <p className="localTakeLead"><strong>{'verdict' in recommendation ? recommendation.verdict : recommendation.label}</strong> {recommendation.explanation}</p> : null}
    {details.length ? <details><summary>View fit and friction</summary><div>
      {enhancement.personalFit && details.includes(enhancement.personalFit) ? <span><strong>Fit {enhancement.personalFit.score}</strong>{enhancement.personalFit.explanation}</span> : null}
      {enhancement.urgency && details.includes(enhancement.urgency) ? <span><strong>{enhancement.urgency.label}</strong>{enhancement.urgency.explanation}</span> : null}
      {enhancement.hassle && details.includes(enhancement.hassle) ? <span><strong>Hassle {enhancement.hassle.score}/10</strong>{enhancement.hassle.explanation}</span> : null}
    </div></details> : null}
  </div>;
}

function collateEvents(events: EventItem[]) {
  const groups = new Map<string, EventItem[]>();
  for (const event of events) {
    const key = groupKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()];
}

function groupKey(event: EventItem) {
  if ((event.eventType ?? "concert") === "festival") return event.id;
  const primary = event.matchedArtists.find((artist) => artist.primary) ?? event.matchedArtists[0];
  return primary ? `artist:${primary.name.toLocaleLowerCase()}` : `event:${event.id}`;
}

function collateOccurrenceRows(occurrences: EventItem[]) {
  const rows = new Map<string, { key: string; eventId: string; dateLocal: string | null; venue: string; links: Array<{ source: string; url: string }> }>();
  for (const occurrence of occurrences) {
    const dateKey = occurrence.startLocal ? String(occurrence.startLocal).slice(0, 10) : "tbd";
    const venue = occurrence.venue.name || occurrence.venue.city || "Venue TBD";
    const key = `${dateKey}|${venue.toLocaleLowerCase()}`;
    const row = rows.get(key) ?? { key, eventId: occurrence.id, dateLocal: occurrence.startLocal, venue, links: [] };
    const links = occurrence.sourceLinks?.length ? occurrence.sourceLinks : [{ source: occurrence.sources?.[0] ?? "source", url: occurrence.sourceUrl }];
    for (const link of links) {
      if (link.url && !row.links.some((existing) => existing.source === link.source && existing.url === link.url)) row.links.push(link);
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => String(left.dateLocal).localeCompare(String(right.dateLocal)));
}

function providerLabel(value: string) {
  return ({ seatgeek: "SeatGeek", ticketmaster: "Ticketmaster", framework: "Framework", insomniac: "Insomniac", source: "Source" } as Record<string, string>)[value] ?? value;
}

function eventComparator(mode: SortMode) {
  const urgency = (value: string) => ({ "buy now": 0, watch: 1, "safe to wait": 2 }[value] ?? 3);
  return (left: EventItem, right: EventItem) => {
    if (mode === "date") return String(left.startLocal).localeCompare(String(right.startLocal));
    if (mode === "urgency") return urgency(left.ranking.urgency) - urgency(right.ranking.urgency) || String(left.startLocal).localeCompare(String(right.startLocal));
    if (mode === "hassle") return left.ranking.hassleScore - right.ranking.hassleScore || right.ranking.artistFit - left.ranking.artistFit;
    return right.ranking.utility - left.ranking.utility || String(left.startLocal).localeCompare(String(right.startLocal));
  };
}
