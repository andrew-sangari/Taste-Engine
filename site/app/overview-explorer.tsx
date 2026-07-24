import { CardActions, calendarInputFrom, planningInputFrom } from "./card-actions";
import { ChangesStrip, type ChangesSinceRefresh } from "./changes-strip";
import type { PublicFeedbackSnapshot } from "./feedback-store";
import { RecommendationVisual, type RecommendationVisual as RecommendationVisualType } from "./recommendation-visual";
import { RecommendationScore } from "./signal-texture";
import { eventHref } from "./event-anchor";
import { formatLocalDate as formatLaDate } from "./local-date";

type OverviewItem = {
  vertical: 'music' | 'movies' | 'sports';
  id: string;
  title: string;
  sourceUrl: string;
  startLocal: string | null;
  venue: { name: string; city: string };
  score: number;
  interestScore: number | null;
  hassleScore: number | null;
  urgency: string;
  confidence: string;
  reason: string;
  call?: string;
  bucket?: 'current' | 'plan-ahead';
  visual?: RecommendationVisualType;
  eventType?: string;
  feedbackSnapshot?: PublicFeedbackSnapshot | null;
};

type Editorial = {
  headline: string;
  verdict: string;
  lead: string;
  skipCall: string;
  decisionNotes?: string[];
};

export function OverviewExplorer({ overview, planAhead, generatedAt, projectionGeneratedAt, editorial, dateAwareRefresh = false, changesSinceRefresh = null }: { overview: OverviewItem[]; planAhead: OverviewItem[]; generatedAt: string; projectionGeneratedAt?: string; editorial?: Editorial; dateAwareRefresh?: boolean; changesSinceRefresh?: ChangesSinceRefresh | null }) {
  const liveEditorial = editorial ? {
    ...editorial,
    lead: dateAwareRefresh ? dropStaleSentences(editorial.lead) : editorial.lead,
    skipCall: dateAwareRefresh ? dropStaleSentences(editorial.skipCall) : editorial.skipCall
  } : undefined;
  const headline = formatEditorialHeadline(liveEditorial?.headline ?? (overview.length ? 'Worth making a plan for.' : "Don't waste your time this weekend."));
  const lead = formatEditorialCopy(liveEditorial?.lead || 'The short list is intentionally small; the verticals retain the full evidence when you want to explore.');
  const asOfDate = new Date(projectionGeneratedAt ?? generatedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" });
  return (
    <section className="overviewSection" aria-label="Current music and sports shortlist" id="overview-feed">
      <div className="overviewIntro rv">
        <div>
          <p className="eyebrow">Current call · next 14 days · {dateAwareRefresh ? 'as of' : 'refreshed'} {asOfDate}</p>
          <h2>{headline}</h2>
        </div>
        <div className="overviewVerdictCopy">
          <p>{lead}</p>
          {liveEditorial?.skipCall ? <p className="overviewSkip"><strong>Skip call</strong> {formatEditorialCopy(liveEditorial.skipCall)}</p> : null}
        </div>
      </div>

      <ChangesStrip changes={changesSinceRefresh} />

      {overview.length ? (
        <div className="overviewGrid" data-stagger="">
          {overview.slice(0, 5).map((item, index) => <OverviewCard item={item} index={index} key={item.id} />)}
        </div>
      ) : (
        <div className="overviewEmpty">
          <p className="eyebrow">Current window</p>
          <h3>{liveEditorial?.verdict === 'do not waste your time' ? "Don't waste your time this weekend." : 'Nothing clears the current bar yet.'}</h3>
          <p>{liveEditorial?.skipCall ?? 'The full vertical views remain available when you want to inspect the evidence.'}</p>
        </div>
      )}

      <section className="planAhead" aria-label="Plan ahead recommendations">
        <div className="planAheadIntro rv"><h3>Plan ahead</h3><p>Exceptional longer-lead dates · ranked by fit.</p></div>
        {planAhead.length ? <div className="planAheadGrid" data-stagger="">
          {planAhead.slice(0, 3).map((item, index) => <OverviewCard item={item} index={index} key={item.id} planAhead />)}
        </div> : <p className="planAheadEmpty">No later date currently clears the planning bar.</p>}
      </section>

      {dateAwareRefresh ? <p className="overviewRefreshNote">Past dates are hidden automatically as the calendar moves forward. Refresh the projection when you want new source coverage.</p> : null}
    </section>
  );
}

const STALE_REFERENCE = /\b(today|tonight|this (?:morning|afternoon|evening|weekend|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|immediate(?:ly)? option)\b/i;

function dropStaleSentences(copy: string | undefined) {
  if (!copy) return copy ?? '';
  const sentences = copy.match(/[^.!?]+[.!?]*\s*/g) ?? [copy];
  return sentences.filter((sentence) => !STALE_REFERENCE.test(sentence)).join('').trim();
}

function OverviewCard({ item, index, planAhead = false }: { item: OverviewItem; index: number; planAhead?: boolean }) {
  const verticalLabel = item.vertical === 'sports' ? 'Sports' : item.vertical === 'movies' ? 'Movies' : 'Music';
  return (
    <article className={`overviewCard rv overviewRank-${index + 1} ${index === 0 && !planAhead ? `overviewFeatured overviewFeatured-${item.vertical}` : ''} ${planAhead ? 'planAheadCard' : ''}`}>
      <span className="ghostRank" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <RecommendationVisual className="overviewVisual" visual={item.visual} />
      <span className={`verticalBadge overviewCardBadge vertical-${item.vertical}`}>{verticalLabel}</span>
      <div className="feature-card__content overviewCardContent">
        <div className="overviewTopline"><span className="overviewNumber">{String(index + 1).padStart(2, '0')}</span></div>
        <p className="overviewDate">{formatLocalDate(item.startLocal)}</p>
        <h3>{formatEditorialTitle(item.title)}</h3>
        <p className="overviewPlace">{item.venue?.name ?? 'Venue TBD'} · {item.venue?.city ?? 'Los Angeles'}</p>
        <p className="overviewReason">{item.reason}</p>
        <div className="overviewUtility">
          <RecommendationScore
            confidence={item.confidence}
            fit={item.interestScore ?? item.score}
            friction={item.hassleScore}
            score={item.score}
            status={item.call ?? callLabel(item.score)}
            urgency={item.urgency}
          />
          <a className="overviewUtilityCta" href={eventHref(item.id)}>View in {verticalLabel} <span aria-hidden="true">→</span></a>
          <CardActions
            calendarEvent={calendarInputFrom({ ...item, description: item.reason })}
            layout="overview"
            planning={item.vertical === 'movies' ? null : planningInputFrom(item.vertical, item)}
          />
        </div>
      </div>
    </article>
  );
}

function formatEditorialTitle(title: string) {
  return title.replace(/\bJOJI\b/gi, 'Joji');
}

function formatEditorialCopy(copy: string) {
  return copy.replace(/\bJOJI\b/gi, 'Joji');
}

function formatEditorialHeadline(headline: string) {
  const normalized = headline.trim();
  if (!normalized) return normalized;
  const proper = new Map([
    ['joji', 'Joji'],
    ['tmdb', 'TMDB'],
    ['mlb', 'MLB'],
    ['dodgers', 'Dodgers'],
    ['framework', 'Framework'],
    ['ticketmaster', 'Ticketmaster'],
    ['seatgeek', 'SeatGeek'],
    ['ollama', 'Ollama'],
    ['gemma', 'Gemma'],
    ['last.fm', 'Last.fm']
  ]);
  return normalized.split(/(\s+)/).map((token, index) => {
    if (/^\s+$/.test(token)) return token;
    const match = token.match(/^([^A-Za-z0-9]*)([A-Za-z0-9.'’-]+)([^A-Za-z0-9]*)$/);
    if (!match) return token;
    const [, prefix, core, suffix] = match;
    const known = proper.get(core.toLowerCase());
    if (known) return `${prefix}${known}${suffix}`;
    const sentenceCore = core.toLowerCase();
    const rendered = index === 0 ? sentenceCore.charAt(0).toUpperCase() + sentenceCore.slice(1) : sentenceCore;
    return `${prefix}${rendered}${suffix}`;
  }).join('');
}

function formatLocalDate(value: string | null) {
  return formatLaDate(value, { weekday: 'short', month: 'short', day: 'numeric' }) ?? 'Date TBD';
}

function callLabel(score: number) {
  if (score >= 75) return 'Strong fit';
  if (score >= 55) return 'Selective';
  if (score >= 40) return 'Wildcard';
  return 'Watch';
}
