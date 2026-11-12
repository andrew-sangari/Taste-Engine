// Generated from deterministic Taste Engine modules. Do not edit directly.


// ../src/eventType.js
function classifyEventType(event) {
  const title = String(event?.title ?? "").toLowerCase();
  if (title.includes("festival") || String(event?.type ?? "").includes("festival") || (event?.destination?.days?.length ?? 0) > 1 || (event?.performers?.length ?? 0) >= 6) return "festival";
  if (title.includes("dj set") || title.includes("open to close")) return "dj set";
  return "concert";
}

// ../src/localDate.js
function localDateKey(value) {
  const key = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}
function localDateAtNoon(value) {
  const key = localDateKey(value);
  return key ? /* @__PURE__ */ new Date(`${key}T12:00:00Z`) : null;
}
function localDateDifference(value, now = /* @__PURE__ */ new Date(), timeZone = "America/Los_Angeles") {
  const event = localDateAtNoon(value);
  if (!event || Number.isNaN(new Date(now).getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(now)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const reference = /* @__PURE__ */ new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  return Math.round((event.getTime() - reference.getTime()) / 864e5);
}

// ../src/ranking.js
var URGENCY_PRIORITY = Object.freeze({ "safe to wait": 0, watch: 1, "buy now": 2 });
var UNORDERED_URGENCIES = Object.freeze(["unknown", "likely unavailable"]);
var PROMOTER_SOURCES = Object.freeze(["framework", "insomniac"]);
function callLabel(score) {
  if (score >= 75) return "Strong fit";
  if (score >= 55) return "Selective";
  if (score >= 40) return "Wildcard";
  return "Watch";
}
function normalizeArtistName(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(live|dj set|live set)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// ../src/feedbackPolicy.js
var FEEDBACK_POLICY = Object.freeze({
  version: 4,
  priorStrength: 1.5,
  tasteHalfLifeDays: 365,
  frictionHalfLifeDays: 180,
  caps: Object.freeze({ artist: 6, venue: 3, promoter: 2, shape: 1.5, opponent: 3 }),
  maxTotalAdjustment: 10,
  maxFriction: 2
});
var INTEREST_STATUS = "interested";
var TASTE_REASONS = Object.freeze(["artist", "lineup", "production", "crowd", "venue"]);
var LOGISTICS_REASONS = Object.freeze(["timing", "hassle", "price", "distance", "availability", "calendar", "recovery"]);
var TASTE_CATEGORIES = ["artist", "venue", "promoter", "shape", "opponent"];
var FRICTION_CATEGORIES = ["venue", "weekday", "shape"];
var REASON_SCOPE = {
  artist: ["artist"],
  lineup: ["artist"],
  venue: ["venue"],
  production: ["venue", "promoter"],
  crowd: ["venue", "promoter", "shape"]
};
var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function feedbackKeysFor(item, vertical = "music") {
  if (!item || typeof item !== "object") return {};
  const keys = {};
  const add = (category, id, label) => {
    const normalized = normalizeArtistName(id);
    if (!normalized) return;
    const list2 = keys[category] ?? (keys[category] = []);
    const key = `${category}:${normalized}`;
    if (!list2.some((entry) => entry.key === key)) list2.push({ key, label: String(label ?? id).trim().slice(0, 120) });
  };
  const venue = item.venue ?? {};
  if (venue.name) add("venue", `${venue.name} ${venue.city ?? ""}`, venue.name);
  const weekday = weekdayOf(item.startLocal);
  if (weekday != null) add("weekday", WEEKDAYS[weekday], `${WEEKDAYS[weekday]}s`);
  if (vertical === "sports") {
    const football = (item.league ?? item.sportsContext?.league) === "nfl" || String(item.id ?? "").startsWith("nfl:");
    add("shape", football ? "football" : "baseball", football ? "Rams games" : "Dodgers games");
    const opponent = item.awayTeam?.name ?? item.awayTeam?.shortName;
    if (opponent) add("opponent", opponent, opponent);
    return keys;
  }
  for (const performer of (item.performers ?? []).slice(0, 12)) add("artist", performer?.name, performer?.name);
  const sources = new Set([
    ...item.sources ?? [],
    ...(item.sourceOccurrences ?? []).map((occurrence) => occurrence?.source),
    item.source
  ].filter(Boolean));
  for (const promoter of item.promoters ?? []) add("promoter", promoter, promoter);
  for (const source of PROMOTER_SOURCES) {
    if (sources.has(source)) add("promoter", source, source === "insomniac" ? "Insomniac" : "Framework");
  }
  const shape = item.eventType ?? classifyEventType(item);
  add("shape", shape, shape === "dj set" ? "DJ sets" : `${shape}s`);
  return keys;
}
function deriveFeedbackSignals(records = [], { now = /* @__PURE__ */ new Date(), policy = FEEDBACK_POLICY } = {}) {
  const nowMs = new Date(now).getTime();
  const latestByEvent = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const eventKey = `${record.canonicalEventId ?? ""}|${record.eventDateLocal ?? ""}`;
    const current = latestByEvent.get(eventKey);
    if (!current || String(record.recordedAt ?? "") >= String(current.recordedAt ?? "")) latestByEvent.set(eventKey, record);
  }
  const taste = /* @__PURE__ */ new Map();
  const friction = /* @__PURE__ */ new Map();
  let countedRecords = 0;
  for (const record of latestByEvent.values()) {
    const reading = readRecord(record);
    if (!reading.taste && !reading.friction) continue;
    const keys = recordKeys(record);
    if (!Object.keys(keys).length) continue;
    countedRecords += 1;
    const date = signalDate(record, nowMs);
    const ageDays = Math.max(0, (nowMs - date) / 864e5);
    if (reading.taste) {
      const decay = 2 ** (-ageDays / policy.tasteHalfLifeDays);
      for (const category of reading.taste.categories.filter((item) => TASTE_CATEGORIES.includes(item))) {
        for (const entry of keys[category] ?? []) accumulate(taste, category, entry, reading.taste.value, reading.taste.weight * decay, record);
      }
    }
    if (reading.friction) {
      const decay = 2 ** (-ageDays / policy.frictionHalfLifeDays);
      for (const category of FRICTION_CATEGORIES) {
        for (const entry of keys[category] ?? []) accumulate(friction, category, entry, reading.friction.value, reading.friction.weight * decay, record);
      }
    }
  }
  for (const signal of taste.values()) finalize(signal, policy, policy.caps[signal.category] ?? 0);
  for (const signal of friction.values()) finalize(signal, policy, policy.maxFriction);
  return { policyVersion: policy.version, taste, friction, countedRecords };
}
function applyFeedbackOverlay(rows, vertical, signals, { policy = FEEDBACK_POLICY } = {}) {
  const audit = { policyVersion: policy.version, adjustedCount: 0, totalAbsoluteAdjustment: 0, maxTotalAdjustment: policy.maxTotalAdjustment };
  if (!signals?.taste?.size && !signals?.friction?.size) return { rows, audit };
  const adjusted = rows.map((row) => {
    if (!row?.ranking || row.ranking.excluded) return row;
    const keys = row.feedbackKeys && Object.keys(row.feedbackKeys).length ? row.feedbackKeys : feedbackKeysFor(row, vertical);
    const taste = matchSignals(keys, signals.taste, TASTE_CATEGORIES);
    const friction = matchSignals(keys, signals.friction, FRICTION_CATEGORIES);
    const tasteDelta = Math.max(-policy.maxTotalAdjustment, Math.min(policy.maxTotalAdjustment, taste.reduce((sum, match) => sum + match.delta, 0)));
    const baseHassle = Number(row.ranking.hassleScore ?? 0);
    const frictionPoints = Math.max(-policy.maxFriction, Math.min(policy.maxFriction, Math.round(friction.reduce((sum, match) => sum + match.delta, 0))));
    const hassleScore = Math.max(0, Math.min(10, baseHassle + frictionPoints));
    const scoreDelta = round(tasteDelta - (hassleScore - baseHassle) * 2);
    if (!scoreDelta) return row;
    audit.adjustedCount += 1;
    audit.totalAbsoluteAdjustment = round(audit.totalAbsoluteAdjustment + Math.abs(scoreDelta));
    const baseUtility = Number(row.ranking.utility ?? 0);
    const utility = round(baseUtility + scoreDelta);
    const reasons = [
      ...taste.map((match) => ({ kind: "taste", category: match.category, label: match.label, delta: round(match.delta), outcomes: match.outcomes })),
      ...hassleScore !== baseHassle ? friction.map((match) => ({ kind: "friction", category: match.category, label: match.label, delta: round(-(hassleScore - baseHassle) * 2 / friction.length), outcomes: match.outcomes })) : []
    ].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
    return {
      ...row,
      ranking: {
        ...row.ranking,
        baseUtility,
        utility,
        hassleScore,
        ...row.ranking.call ? { call: callLabel(utility) } : {},
        feedbackAdjustment: { applied: true, scoreDelta, policyVersion: policy.version, reasons }
      }
    };
  });
  return { rows: adjusted, audit };
}
function describeLearning(signals, { limit = 12 } = {}) {
  const rows = [];
  for (const [kind, map] of [["taste", signals?.taste], ["friction", signals?.friction]]) {
    for (const signal of map?.values() ?? []) {
      if (Math.abs(signal.delta) < 0.25) continue;
      rows.push({
        kind,
        category: signal.category,
        label: signal.label,
        direction: signal.delta > 0 ? "up" : "down",
        strength: round(Math.abs(signal.score)),
        delta: round(signal.delta),
        outcomes: signal.outcomes,
        lastDate: signal.lastDate
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label)).slice(0, limit);
}
function readRecord(record) {
  const status = String(record.status ?? "");
  const rating = Number.isInteger(record.rating) ? record.rating : null;
  const reasons = Array.isArray(record.reasonCodes) ? record.reasonCodes.map(String) : [];
  const tags = Array.isArray(record.signalTags) ? record.signalTags.map(String) : [];
  const tasteReasons = reasons.filter((reason) => TASTE_REASONS.includes(reason));
  const logistics = [...reasons, ...tags].some((reason) => LOGISTICS_REASONS.includes(reason));
  const scoped = (names) => {
    const categories = [...new Set(names.flatMap((name) => REASON_SCOPE[name] ?? []))];
    return categories.length ? categories : TASTE_CATEGORIES;
  };
  switch (status) {
    case "attended-worth-it":
      return {
        taste: { value: rating === 5 ? 1 : 0.6, weight: 1, categories: scoped(tags) },
        // It was worth the trouble: evidence against treating it as friction.
        friction: logistics ? { value: 0.5, weight: 0.5 } : { value: -0.5, weight: 0.5 }
      };
    case "attended-not-worth-it": {
      const onlyLogistics = logistics && !tasteReasons.length && !tags.some((tag) => REASON_SCOPE[tag]);
      return {
        taste: onlyLogistics ? null : { value: rating === 3 ? -0.3 : -1, weight: 1, categories: scoped([...tasteReasons, ...tags]) },
        friction: logistics ? { value: 1, weight: 0.8 } : null
      };
    }
    case "wanted-to-attend":
      return { taste: { value: 0.4, weight: 0.5, categories: TASTE_CATEGORIES }, friction: logistics ? { value: 1, weight: 0.4 } : null };
    case INTEREST_STATUS:
      return { taste: { value: rating === 5 ? 0.5 : 0.25, weight: rating === 5 ? 0.5 : 0.35, categories: ["artist", "promoter", "opponent"] }, friction: null };
    case "lost-interest":
      return {
        taste: tasteReasons.length ? { value: -0.7, weight: 0.6, categories: scoped(tasteReasons) } : null,
        friction: logistics ? { value: 1, weight: 0.5 } : null
      };
    case "did-not-attend-logistical":
      return { taste: null, friction: { value: 1, weight: 0.6 } };
    default:
      return { taste: null, friction: null };
  }
}
function recordKeys(record) {
  const frozen = record.feedbackKeys;
  if (frozen && typeof frozen === "object" && !Array.isArray(frozen)) {
    const keys = {};
    for (const [category, entries] of Object.entries(frozen)) {
      const list2 = (Array.isArray(entries) ? entries : []).filter((entry) => entry && typeof entry.key === "string" && entry.key.startsWith(`${category}:`)).map((entry) => ({ key: entry.key, label: String(entry.label ?? entry.key.slice(category.length + 1)) }));
      if (list2.length) keys[category] = list2;
    }
    if (Object.keys(keys).length) return keys;
  }
  const title = String(record.eventTitleSnapshot ?? "").replace(/\s*[([][^)\]]*[)\]]/g, "").trim();
  const game = title.match(/^(.+?)\s+at\s+(?:the\s+)?Los Angeles (Dodgers|Rams)$/i);
  if (game) {
    const football = /rams/i.test(game[2]);
    return {
      opponent: [{ key: `opponent:${normalizeArtistName(game[1])}`, label: game[1] }],
      shape: [{ key: `shape:${football ? "football" : "baseball"}`, label: football ? "Rams games" : "Dodgers games" }]
    };
  }
  const headliner = title.split(/\s+with\s+/i)[0].trim();
  if (headliner && !/[:&,]|\bpresents?\b|\bvs\.?\b|\bat\b|\bfestival\b/i.test(headliner)) {
    return { artist: [{ key: `artist:${normalizeArtistName(headliner)}`, label: headliner }] };
  }
  return {};
}
function accumulate(map, category, entry, value, weight, record) {
  if (!(weight > 0)) return;
  const signal = map.get(entry.key) ?? { key: entry.key, category, label: entry.label, weighted: 0, evidence: 0, events: /* @__PURE__ */ new Set(), lastDate: null };
  signal.weighted += value * weight;
  signal.evidence += weight;
  signal.events.add(`${record.canonicalEventId}|${record.eventDateLocal}`);
  const date = String(record.eventDateLocal ?? "").slice(0, 10) || null;
  if (date && (!signal.lastDate || date > signal.lastDate)) signal.lastDate = date;
  map.set(entry.key, signal);
}
function finalize(signal, policy, cap) {
  signal.score = signal.weighted / (signal.evidence + policy.priorStrength);
  signal.delta = signal.score * cap;
  signal.outcomes = signal.events.size;
  delete signal.events;
}
function matchSignals(keys, signalMap, categories) {
  const matches = [];
  for (const category of categories) {
    const hits = (keys[category] ?? []).map((entry) => signalMap.get(entry.key)).filter(Boolean);
    if (!hits.length) continue;
    const evidence = hits.reduce((sum, hit) => sum + hit.evidence, 0);
    const delta = hits.reduce((sum, hit) => sum + hit.delta * hit.evidence, 0) / (evidence || 1);
    const strongest = [...hits].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    matches.push({ category, label: strongest.label, delta, outcomes: hits.reduce((sum, hit) => sum + hit.outcomes, 0) });
  }
  return matches;
}
function signalDate(record, nowMs) {
  const eventMs = Date.parse(`${String(record.eventDateLocal ?? "").slice(0, 10)}T12:00:00Z`);
  const recordedMs = Date.parse(String(record.recordedAt ?? ""));
  if (Number.isFinite(eventMs) && eventMs <= nowMs) return eventMs;
  return Number.isFinite(recordedMs) ? Math.min(recordedMs, nowMs) : nowMs;
}
function weekdayOf(startLocal) {
  const key = String(startLocal ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return (/* @__PURE__ */ new Date(`${key}T12:00:00Z`)).getUTCDay();
}
function round(value) {
  return Math.round(value * 100) / 100;
}

// ../src/visuals.js
var DEFAULT_FOCAL_POINT = Object.freeze({ x: 50, y: 50 });
function resolveMusicVisual(event = {}) {
  const title = String(event.title ?? "").toLowerCase();
  const venue = String(event.venue?.name ?? "").toLowerCase();
  const eventType = String(event.eventType ?? event.type ?? "").toLowerCase();
  if (eventType.includes("festival") || title.includes("festival")) {
    return textureVisual("music-crowd-silhouette", "Crowd and stage haze atmosphere", { x: 76, y: 52 });
  }
  if (eventType.includes("dj") || title.includes("open to close") || venue.includes("warehouse")) {
    return textureVisual("music-warehouse-beams", "Directional warehouse performance light", { x: 82, y: 48 });
  }
  if (/arena|hall|amphitheater|pavilion|theatre|theater/.test(venue)) {
    return textureVisual("music-architectural-light", "Architectural venue light", { x: 76, y: 46 });
  }
  return textureVisual("music-stage-haze", "Stage haze and directional performance light", { x: 78, y: 50 });
}
function resolveSportsVisual(game = {}) {
  const context = game.sportsContext ?? {};
  if (context.playoffLeverage === "high") {
    return textureVisual("sports-scoreboard-glow", "Restrained night-game scoreboard glow", { x: 84, y: 42 });
  }
  if (context.rivalryTier === "high") {
    return textureVisual("sports-field-lines", "Night-game field geometry", { x: 82, y: 58 });
  }
  const hour = localHour(game.startLocal);
  if (hour != null && hour >= 18) {
    return textureVisual("sports-night-game", "Stadium floodlights and dark stands", { x: 82, y: 42 });
  }
  return textureVisual("sports-stadium-lights", "Stadium light atmosphere", { x: 80, y: 50 });
}
function normalizeVisual(visual) {
  if (!visual || typeof visual !== "object") return { kind: "none" };
  const kind = ["image", "texture", "none"].includes(visual.kind) ? visual.kind : "none";
  const normalized = { kind };
  if (visual.url && kind === "image") normalized.url = String(visual.url);
  if (visual.alt) normalized.alt = String(visual.alt);
  if (visual.variant) normalized.variant = String(visual.variant);
  if (visual.attribution) normalized.attribution = String(visual.attribution);
  if (kind !== "none") normalized.focalPoint = normalizeFocalPoint(visual.focalPoint);
  return normalized;
}
function normalizeFocalPoint(value) {
  return {
    x: clampPercent(value?.x),
    y: clampPercent(value?.y)
  };
}
function textureVisual(variant, alt, focalPoint) {
  return normalizeVisual({ kind: "texture", variant, alt, focalPoint });
}
function localHour(value) {
  const match = String(value ?? "").match(/T(\d{2}):/);
  const hour = match ? Number(match[1]) : NaN;
  return Number.isFinite(hour) ? hour : null;
}
function clampPercent(value) {
  if (value == null || value === "") return 50;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 50;
}

// ../src/overview.js
function buildOverviewBuckets(events = [], sports = [], {
  now = /* @__PURE__ */ new Date(),
  currentDays = 14,
  planAheadLimit = 3,
  planAheadMinScore = 55,
  currentMinScore = 28,
  horizonDays = null
} = {}) {
  const candidates = buildCandidates(events, sports);
  const currentPool = candidates.filter((candidate) => {
    const days = daysFrom(candidate.startLocal, now);
    return days != null && days >= 0 && days <= currentDays;
  });
  const representatives = selectRepresentativeCandidates(currentPool).filter((candidate) => candidate.call !== "skip");
  const clearing = representatives.filter((candidate) => candidate.score >= currentMinScore).slice(0, 5);
  const fallback = !clearing.length && representatives[0] && representatives[0].score >= currentMinScore * 0.6 ? [representatives[0]] : [];
  const currentRepresentatives = clearing.length ? clearing : fallback;
  const current = currentRepresentatives.map((candidate) => ({
    ...toOverviewDisplay(candidate),
    bucket: "current",
    ...clearing.length ? {} : { fallback: true }
  }));
  const currentIds = new Set(current.map((candidate) => candidate.id));
  const currentGroups = new Set(currentRepresentatives.map((candidate) => candidate.overviewGroupKey));
  const planAhead = selectRepresentatives(candidates.filter((candidate) => {
    const days = daysFrom(candidate.startLocal, now);
    return !currentIds.has(candidate.id) && !currentGroups.has(candidate.overviewGroupKey) && days != null && days > currentDays && (horizonDays == null || days <= horizonDays) && candidate.score >= planAheadMinScore && candidate.call !== "skip";
  })).slice(0, planAheadLimit).map((candidate) => ({ ...candidate, bucket: "plan-ahead" }));
  return { current, planAhead };
}
function buildCandidates(events = [], sports = []) {
  return [...events.map((event) => ({
    vertical: "music",
    id: event.id,
    title: event.title,
    sourceUrl: event.sourceUrl,
    startLocal: event.startLocal,
    venue: event.venue,
    score: event.ranking.utility,
    interestScore: event.ranking.artistFit,
    hassleScore: event.ranking.hassleScore,
    urgency: event.ranking.urgency,
    confidence: event.ranking.confidence,
    reason: event.ranking.whyYou,
    call: event.ranking.call ?? event.call ?? callLabel(event.ranking.utility),
    localEnhancement: event.localEnhancement,
    semanticInsight: event.semanticInsight ?? null,
    sources: event.sources,
    eventType: event.eventType,
    visual: event.visual ?? resolveMusicVisual(event),
    feedbackSnapshot: event.feedbackSnapshot ?? null,
    feedbackKeys: event.feedbackKeys ?? null,
    discovery: event.ranking.discovery ?? null,
    feedbackAdjustment: event.ranking.feedbackAdjustment ?? null,
    overviewGroupKey: overviewMusicGroupKey(event)
  })), ...sports.map((game) => ({
    vertical: "sports",
    id: game.id,
    title: friendlySportsTitle(game),
    sourceUrl: game.sourceUrl,
    startLocal: game.startLocal,
    venue: game.venue,
    score: game.ranking.utility,
    interestScore: game.ranking.interestScore,
    hassleScore: game.ranking.hassleScore,
    urgency: game.ranking.urgency,
    confidence: game.ranking.confidence,
    reason: game.ranking.whyYou,
    call: game.ranking.call ?? game.call ?? callLabel(game.ranking.utility),
    localEnhancement: game.localEnhancement,
    sources: [...new Set((game.ticketObservations ?? []).map((observation) => observation.source))],
    eventType: game.league === "nfl" ? "football" : "baseball",
    league: game.league ?? "mlb",
    visual: game.visual ?? resolveSportsVisual(game),
    feedbackSnapshot: game.feedbackSnapshot ?? null,
    feedbackKeys: game.feedbackKeys ?? null,
    feedbackAdjustment: game.ranking.feedbackAdjustment ?? null,
    overviewGroupKey: `sports:${game.series?.id ?? normalizeArtistName(game.awayTeam?.name ?? game.id)}`
  }))].sort(overviewComparator);
}
function selectRepresentatives(candidates) {
  return selectRepresentativeCandidates(candidates).map(toOverviewDisplay);
}
function selectRepresentativeCandidates(candidates) {
  const seenGroups = /* @__PURE__ */ new Set();
  const selected = [];
  for (const candidate of candidates) {
    if (seenGroups.has(candidate.overviewGroupKey)) continue;
    seenGroups.add(candidate.overviewGroupKey);
    selected.push(candidate);
  }
  return selected;
}
function toOverviewDisplay(candidate) {
  const { overviewGroupKey: _overviewGroupKey, localEnhancement: _localEnhancement, sources: _sources, ...display } = candidate;
  return display;
}
function overviewMusicGroupKey(event) {
  const primary = event.matchedArtists?.find((artist) => artist.primary) ?? event.matchedArtists?.[0];
  if (primary?.name) return `music:${normalizeArtistName(primary.name)}`;
  if (event.eventType === "festival") return `music-festival:${normalizeArtistName(event.title)}`;
  return `music:${normalizeArtistName(event.title)}`;
}
function friendlySportsTitle(game) {
  const opponent = friendlyTeamName(game.awayTeam);
  const home = game.homeTeam?.name || game.homeTeam?.shortName ? friendlyTeamName(game.homeTeam) : "Dodgers";
  return `${home} vs. ${opponent}`;
}
function friendlyTeamName(team = {}) {
  const name = String(team.name ?? team.shortName ?? "Opponent");
  const known = ["Dodgers", "Diamondbacks", "Padres", "Giants", "Yankees", "Mets", "Cubs", "Cardinals", "Astros", "Red Sox", "Braves", "Phillies", "Brewers", "Marlins", "Nationals", "Reds", "Pirates", "Rockies", "Tigers", "Twins", "White Sox", "Guardians", "Rays", "Blue Jays", "Orioles", "Royals", "Angels", "Athletics", "Mariners", "Rangers"];
  const match = known.find((label) => name.toLocaleLowerCase().includes(label.toLocaleLowerCase()));
  if (match) return match;
  return String(team.shortName ?? name).replace(/^Arizona$/i, "Diamondbacks").replace(/^Los Angeles\s+/i, "").trim();
}
function overviewComparator(left, right) {
  const scoreDelta = right.score - left.score;
  if (Math.abs(scoreDelta) <= 5 && left.vertical !== right.vertical) return left.vertical === "music" ? -1 : 1;
  return scoreDelta || String(left.startLocal).localeCompare(String(right.startLocal));
}
function daysFrom(value, now) {
  return localDateDifference(value, now);
}

// ../src/feedbackReview.js
function buildFeedbackReview({ projection = {}, records = [], now = /* @__PURE__ */ new Date(), currentMinScore = 28, planAheadMinScore = 55, policy = FEEDBACK_POLICY } = {}) {
  const signals = deriveFeedbackSignals(records, { now, policy });
  const baseline = {
    events: (projection.events ?? []).map(withoutAppliedLearning),
    sports: (projection.sports ?? []).map(withoutAppliedLearning)
  };
  const music = applyFeedbackOverlay(baseline.events, "music", signals, { policy });
  const sports = applyFeedbackOverlay(baseline.sports, "sports", signals, { policy });
  const movements = [
    ...movementsFor(baseline.events, music.rows, "music"),
    ...movementsFor(baseline.sports, sports.rows, "sports")
  ].sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta) || a.id.localeCompare(b.id));
  const options = { now, currentDays: 14, currentMinScore, planAheadMinScore, horizonDays: projection.horizon?.days ?? null };
  const before = buildOverviewBuckets(baseline.events, baseline.sports, options);
  const after = buildOverviewBuckets(music.rows, sports.rows, options);
  const shortlist = {
    current: membershipChange(before.current, after.current),
    planAhead: membershipChange(before.planAhead, after.planAhead)
  };
  const learned = describeLearning(signals, { limit: 50 });
  const review = {
    schemaVersion: 2,
    policyVersion: policy.version,
    generatedAt: new Date(now).toISOString(),
    projectionGeneratedAt: projection.generatedAt ?? null,
    countedOutcomeCount: signals.countedRecords,
    learned,
    candidateCount: baseline.events.length + baseline.sports.length,
    adjustedCandidateCount: movements.length,
    largestAdjustment: movements[0]?.scoreDelta ?? 0,
    maxTotalAdjustment: policy.maxTotalAdjustment,
    movements,
    shortlist,
    shortlistChanged: Boolean(shortlist.current.added.length || shortlist.current.removed.length || shortlist.planAhead.added.length || shortlist.planAhead.removed.length)
  };
  return { ...review, digest: digestOf({ policyVersion: review.policyVersion, learned, movements: movements.map(({ id, scoreDelta }) => [id, scoreDelta]) }) };
}
function withoutAppliedLearning(item) {
  const adjustment = item?.ranking?.feedbackAdjustment;
  if (!item?.ranking) return item;
  const { feedbackAdjustment: _adjustment, ...ranking } = item.ranking;
  if (!adjustment?.applied) return { ...item, ranking };
  const { baseUtility, ...rest } = ranking;
  return { ...item, ranking: { ...rest, utility: baseUtility ?? round2(Number(ranking.utility ?? 0) - Number(adjustment.scoreDelta ?? 0)) } };
}
function movementsFor(before, after, vertical) {
  const rank = (items) => new Map([...items].sort((a, b) => b.ranking.utility - a.ranking.utility || String(a.id).localeCompare(String(b.id))).map((item, index) => [item.id, index + 1]));
  const beforeRank = rank(before.filter((item) => item?.ranking));
  const afterRank = rank(after.filter((item) => item?.ranking));
  return after.flatMap((item) => {
    const adjustment = item?.ranking?.feedbackAdjustment;
    if (!adjustment?.scoreDelta) return [];
    return [{
      id: String(item.id),
      vertical,
      title: String(item.title ?? `${item.awayTeam?.name ?? "Away"} at ${item.homeTeam?.name ?? "Home"}`),
      scoreDelta: adjustment.scoreDelta,
      scoreBefore: round2(item.ranking.utility - adjustment.scoreDelta),
      scoreAfter: item.ranking.utility,
      rankBefore: beforeRank.get(item.id) ?? null,
      rankAfter: afterRank.get(item.id) ?? null,
      reasons: adjustment.reasons ?? []
    }];
  });
}
function membershipChange(before, after) {
  const beforeIds = new Set(before.map((item) => String(item.id)));
  const afterIds = new Set(after.map((item) => String(item.id)));
  return {
    added: [...afterIds].filter((id) => !beforeIds.has(id)).sort(),
    removed: [...beforeIds].filter((id) => !afterIds.has(id)).sort()
  };
}
function digestOf(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fr${hash.toString(16).padStart(8, "0")}-${text.length.toString(36)}`;
}
function round2(value) {
  return Math.round(value * 100) / 100;
}

// ../src/decisionPlan.js
var PLAN_POLICY = Object.freeze({
  version: 1,
  // A score at or below the bar is not worth a night and is never picked
  // unless pinned.
  bar: 40,
  windowDayOptions: Object.freeze([14, 30, 60, 90]),
  maxNightsPerWeek: 7,
  maxBudgetUsd: 1e5,
  // Longest window `planCandidates` will normalize, whatever the caller asks.
  maxCandidateWindowDays: 366,
  timeZone: "America/Los_Angeles",
  lensOrder: Object.freeze(["best", "easy", "mix"]),
  // "Least effort" prices hassle, charges a flat cost for every night out (so
  // the plan is shorter, not just gentler) and charges a trip once more.
  easy: Object.freeze({ hassleWeight: 3, nightCost: 4, tripPenalty: 10 }),
  // "Widest mix" bonuses are concave: each distinct kind and venue pays once,
  // discoveries pay for the first `discoveryLimit` only. One night can earn at
  // most kind + discovery + venue = 10.5 points, well short of a 20-point gap.
  mix: Object.freeze({ kindBonus: 6, discoveryBonus: 3, discoveryLimit: 2, venueBonus: 1.5 }),
  gaveUpLimit: 3,
  // Search nodes per lens before the solver returns its best so far and marks
  // the plan `exact: false`. Realistic inputs use a few hundred.
  nodeBudget: 25e4,
  // States remembered per (day, week load, yesterday) for dominance pruning.
  labelsPerState: 256,
  // How many budget prices (Lagrange multipliers) the upper bound is taken over.
  budgetMultipliers: 12
});
var DEFAULT_PLAN_CONSTRAINTS = Object.freeze({
  windowDays: 30,
  nightsPerWeek: 2,
  budgetUsd: null,
  avoidBackToBack: true,
  includeTrips: true
});
var LENS_COPY = {
  best: { label: "Best nights", tagline: (days) => `The highest-value way to spend the next ${days} days.` },
  easy: { label: "Least effort", tagline: () => "Fewer, easier nights that still clear the bar." },
  mix: { label: "Widest mix", tagline: () => "A spread across kinds of night, venues and discoveries." }
};
var UNIT = 100;
var DAY_MS = 864e5;
var NO_CLAIMS = Object.freeze([]);
var NO_BITS = Object.freeze([]);
var BITS_PER_WORD = 30;
var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
var TEAM_NICKNAMES = ["Dodgers", "Diamondbacks", "Padres", "Giants", "Yankees", "Mets", "Cubs", "Cardinals", "Astros", "Red Sox", "Braves", "Phillies", "Brewers", "Marlins", "Nationals", "Reds", "Pirates", "Rockies", "Tigers", "Twins", "White Sox", "Guardians", "Rays", "Blue Jays", "Orioles", "Royals", "Angels", "Athletics", "Mariners", "Rangers"];
var ORDINALS = ["", "a first", "a second", "a third", "a fourth", "a fifth", "a sixth", "a seventh", "an eighth"];
function normalizePlanConstraints(input) {
  const result = { ...DEFAULT_PLAN_CONSTRAINTS };
  let source;
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return result;
    source = {
      windowDays: input.windowDays,
      nightsPerWeek: input.nightsPerWeek,
      budgetUsd: input.budgetUsd,
      avoidBackToBack: input.avoidBackToBack,
      includeTrips: input.includeTrips
    };
  } catch {
    return result;
  }
  const windowDays = plainNumber(source.windowDays);
  if (PLAN_POLICY.windowDayOptions.includes(windowDays)) result.windowDays = windowDays;
  const nights = plainNumber(source.nightsPerWeek);
  if (Number.isFinite(nights)) result.nightsPerWeek = Math.max(1, Math.min(PLAN_POLICY.maxNightsPerWeek, Math.round(nights)));
  const budget = source.budgetUsd == null ? NaN : plainNumber(source.budgetUsd);
  if (Number.isFinite(budget)) result.budgetUsd = Math.round(Math.max(0, Math.min(PLAN_POLICY.maxBudgetUsd, budget)) * 100) / 100;
  if (typeof source.avoidBackToBack === "boolean") result.avoidBackToBack = source.avoidBackToBack;
  if (typeof source.includeTrips === "boolean") result.includeTrips = source.includeTrips;
  return result;
}
function planCandidates({ events = [], sports = [], now, windowDays } = {}) {
  const today = todayNumber(now);
  if (today == null) return [];
  const requested = plainNumber(windowDays);
  const span = Number.isFinite(requested) && requested >= 1 ? Math.min(PLAN_POLICY.maxCandidateWindowDays, Math.floor(requested)) : DEFAULT_PLAN_CONSTRAINTS.windowDays;
  const candidates = [];
  const collect = (rows, build) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== "object" || row.id == null || row.ranking?.excluded === true) continue;
      const start = dayNumber(row.startLocal);
      const utility = row.ranking?.utility;
      if (start == null || start < today || start >= today + span) continue;
      if (typeof utility !== "number" || !Number.isFinite(utility)) continue;
      candidates.push(build(row, start));
    }
  };
  collect(events, musicCandidate);
  collect(sports, sportsCandidate);
  return candidates.sort((left, right) => compareText(left.startLocal, right.startLocal) || compareText(left.id, right.id));
}
function buildDecisionPlans({ candidates = [], constraints, pinnedIds = [], excludedIds = [], now, policy = PLAN_POLICY } = {}) {
  const rules = normalizePlanConstraints(constraints);
  const pinnedSet = idSet(pinnedIds);
  const excludedSet = idSet(excludedIds);
  const prepared = prepareCandidates(candidates);
  const start = todayNumber(now, policy.timeZone) ?? (prepared.length ? prepared[0].first : null);
  const end = start == null ? null : start + rules.windowDays - 1;
  const considered = prepared.filter((entry) => entry.first >= start && entry.first <= end && (pinnedSet.has(entry.id) || !excludedSet.has(entry.id)));
  const pinned = considered.filter((entry) => pinnedSet.has(entry.id));
  const worthwhile = considered.filter((entry) => entry.score > policy.bar);
  const env = planEnvironment(considered, pinned, rules, policy);
  const solved = [];
  for (const lens of policy.lensOrder) {
    const model = buildModel(lens, env, policy);
    const outcome = search(model, policy.nodeBudget, policy.labelsPerState);
    const picks = [...pinned, ...outcome.entries].sort(compareEntries);
    const signature = picks.map((entry) => entry.id).join("\0");
    const twin = solved.find((plan) => plan.signature === signature);
    if (twin) {
      twin.alsoLenses.push(lens);
      twin.exact = twin.exact && outcome.exact;
      continue;
    }
    solved.push({ lens, alsoLenses: [], picks, signature, exact: outcome.exact });
  }
  const plans = solved.map((plan) => describePlan(plan, { env, worthwhile, rules, policy }));
  const best = plans[0];
  for (const plan of plans.slice(1)) {
    plan.versusBest = {
      score: round22(plan.totals.score - best.totals.score),
      knownCostUsd: round22(plan.totals.knownCostUsd - best.totals.knownCostUsd),
      hassle: round22(plan.totals.hassle - best.totals.hassle),
      nights: plan.totals.nights - best.totals.nights
    };
  }
  return {
    policyVersion: policy.version,
    window: {
      startDate: start == null ? null : dateKey(start),
      endDate: end == null ? null : dateKey(end),
      days: rules.windowDays
    },
    constraints: rules,
    consideredCount: considered.length,
    worthwhileCount: worthwhile.length,
    pinned: pinned.map((entry) => entry.id),
    pinnedConflicts: pinnedConflicts(pinned),
    plans,
    empty: plans.every((plan) => plan.picks.length === 0)
  };
}
function musicCandidate(row, start) {
  const destination = row.destination && typeof row.destination === "object" ? row.destination : null;
  const tripDays = uniqueDayNumbers(Array.isArray(destination?.days) ? destination.days : []);
  const tier = typeof row.ranking.discovery?.tier === "string" ? row.ranking.discovery.tier : null;
  return {
    id: String(row.id),
    vertical: "music",
    title: String(row.title ?? row.eventName ?? destination?.name ?? "Untitled event"),
    startLocal: String(row.startLocal),
    days: (tripDays.length ? tripDays : [start]).map(dateKey),
    score: Math.round(row.ranking.utility),
    hassle: hassleOf(row.ranking.hassleScore),
    priceUsd: priceOf(row.ticketObservation?.lowestPriceUsd),
    venue: venueName(row.venue),
    tier,
    isTrip: Boolean(destination),
    // A discovery is anything that reached the list by a path other than the
    // person's own playlists. It is a path, not proof the artist is unheard.
    isNew: tier != null && tier !== "direct" && tier !== "none"
  };
}
function sportsCandidate(row, start) {
  const league = String(row.league ?? row.sportsContext?.league ?? "").toLowerCase() === "nfl" || String(row.id).startsWith("nfl:") ? "nfl" : "mlb";
  const prices = (Array.isArray(row.ticketObservations) ? row.ticketObservations : []).map((observation) => priceOf(observation?.lowestPriceUsd)).filter((price) => price != null);
  return {
    id: String(row.id),
    vertical: "sports",
    league,
    title: `${teamNickname(row.homeTeam, league === "nfl" ? "Rams" : "Dodgers")} vs. ${teamNickname(row.awayTeam, "Opponent")}`,
    startLocal: String(row.startLocal),
    days: [dateKey(start)],
    score: Math.round(row.ranking.utility),
    hassle: hassleOf(row.ranking.hassleScore),
    priceUsd: prices.length ? Math.min(...prices) : null,
    venue: venueName(row.venue),
    tier: null,
    isTrip: false,
    isNew: false
  };
}
function teamNickname(team, fallback) {
  const name = String(team?.name ?? team?.shortName ?? "").trim();
  if (!name) return fallback;
  const lowered = name.toLowerCase();
  const known = TEAM_NICKNAMES.find((nickname) => lowered.includes(nickname.toLowerCase()));
  if (known) return known;
  return String(team.shortName ?? name).replace(/^Arizona$/i, "Diamondbacks").replace(/^(Los Angeles|LA)\s+/i, "").trim() || fallback;
}
function venueName(venue) {
  if (typeof venue === "string") return venue.trim();
  return typeof venue?.name === "string" ? venue.name.trim() : "";
}
function priceOf(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function hassleOf(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(10, value)) : 0;
}
function prepareCandidates(candidates) {
  const entries = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate !== "object" || candidate.id == null) continue;
    const days = uniqueDayNumbers(Array.isArray(candidate.days) && candidate.days.length ? candidate.days : [candidate.startLocal]);
    const score = plainNumber(candidate.score);
    if (!days.length || !Number.isFinite(score)) continue;
    const price = priceOf(candidate.priceUsd);
    const sports = candidate.vertical === "sports";
    entries.push({
      id: String(candidate.id),
      candidate,
      days,
      first: days[0],
      weeks: weekCounts(days),
      score,
      hassle: hassleOf(candidate.hassle),
      cents: price == null ? null : Math.round(price * 100),
      isTrip: Boolean(candidate.isTrip),
      isNew: Boolean(candidate.isNew),
      sports,
      kind: sports ? `sports:${String(candidate.league ?? "mlb").toLowerCase()}` : "music",
      venueKey: typeof candidate.venue === "string" ? candidate.venue.trim().toLowerCase() : "",
      title: String(candidate.title ?? candidate.id),
      startLocal: String(candidate.startLocal ?? dateKey(days[0]))
    });
  }
  entries.sort((left, right) => compareEntries(left, right) || right.score - left.score || compareText(left.title, right.title) || compareText(left.days.join(), right.days.join()));
  const seen = /* @__PURE__ */ new Set();
  return entries.filter((entry) => !seen.has(entry.id) && seen.add(entry.id));
}
function planEnvironment(considered, pinned, rules, policy) {
  const pinnedDays = /* @__PURE__ */ new Set();
  for (const entry of pinned) for (const day of entry.days) pinnedDays.add(day);
  const pinnedWeekLoad = /* @__PURE__ */ new Map();
  for (const day of pinnedDays) pinnedWeekLoad.set(weekIndex(day), (pinnedWeekLoad.get(weekIndex(day)) ?? 0) + 1);
  const capacity = (week) => rules.nightsPerWeek - (pinnedWeekLoad.get(week) ?? 0);
  const budgetCents = rules.budgetUsd == null ? null : Math.round(rules.budgetUsd * 100);
  const pinnedCents = pinned.reduce((sum, entry) => sum + (entry.cents ?? 0), 0);
  const budgetLeft = budgetCents == null ? Infinity : Math.max(0, budgetCents - pinnedCents);
  const blocked = (day) => pinnedDays.has(day) || rules.avoidBackToBack && (pinnedDays.has(day - 1) || pinnedDays.has(day + 1));
  const pinnedIdSet = new Set(pinned.map((entry) => entry.id));
  const pool = considered.filter((entry) => !pinnedIdSet.has(entry.id) && entry.score > policy.bar && (rules.includeTrips || !entry.isTrip) && !entry.days.some(blocked) && entry.weeks.every(([week, count]) => count <= capacity(week)) && (entry.cents ?? 0) <= budgetLeft);
  return { considered, pinned, pool, capacity, budgetCents, budgetLeft, avoid: rules.avoidBackToBack };
}
function pinnedConflicts(pinned) {
  const conflicts = [];
  for (let a = 0; a < pinned.length; a += 1) {
    for (let b = a + 1; b < pinned.length; b += 1) {
      const day = pinned[a].days.find((value) => pinned[b].days.includes(value));
      if (day != null) conflicts.push({ ids: [pinned[a].id, pinned[b].id], day: dateKey(day) });
    }
  }
  return conflicts.sort((left, right) => compareText(left.day, right.day));
}
function nightValue(lens, entry, policy) {
  const base = entry.score - policy.bar;
  if (lens !== "easy") return Math.round(base * UNIT);
  const effort = policy.easy.hassleWeight * entry.hassle + policy.easy.nightCost * entry.days.length + (entry.isTrip ? policy.easy.tripPenalty : 0);
  return Math.round((base - effort) * UNIT);
}
function objectiveValue(lens, picks, policy) {
  let value = picks.reduce((sum, entry) => sum + nightValue(lens, entry, policy), 0);
  if (lens === "mix") {
    const kinds = new Set(picks.map((entry) => entry.kind));
    const venues = new Set(picks.map((entry) => entry.venueKey).filter(Boolean));
    const discoveries = Math.min(policy.mix.discoveryLimit, picks.filter((entry) => entry.isNew).length);
    value += kinds.size * Math.round(policy.mix.kindBonus * UNIT) + venues.size * Math.round(policy.mix.venueBonus * UNIT) + discoveries * Math.round(policy.mix.discoveryBonus * UNIT);
  }
  return value;
}
function buildModel(lens, env, policy) {
  const budgeted = env.budgetLeft !== Infinity;
  const items = [];
  for (const entry of env.pool) {
    const value = nightValue(lens, entry, policy);
    if (value > 0) items.push({ entry, value, cost: budgeted ? entry.cents ?? 0 : 0, days: entry.days, weeks: entry.weeks, features: [], tracksNew: false });
  }
  const bonuses = [];
  let venueBitsFrom = 0;
  let slots = 0;
  const discoveryBonus = Math.round(policy.mix.discoveryBonus * UNIT);
  const kindBonus = Math.round(policy.mix.kindBonus * UNIT);
  const venueBonus = Math.round(policy.mix.venueBonus * UNIT);
  if (lens === "mix") {
    const share = (keyOf, bonus) => {
      const earned = new Set(env.pinned.map(keyOf));
      const groups = /* @__PURE__ */ new Map();
      for (const item of items) {
        const key = keyOf(item.entry);
        if (!key || earned.has(key)) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      for (const group of groups.values()) {
        if (group.length === 1) {
          group[0].value += bonus;
          continue;
        }
        const bit = bonuses.push(bonus) - 1;
        for (const item of group) item.features.push(bit);
      }
    };
    share((entry) => entry.kind, kindBonus);
    venueBitsFrom = bonuses.length;
    share((entry) => entry.venueKey, venueBonus);
    const open = Math.max(0, policy.mix.discoveryLimit - env.pinned.filter((entry) => entry.isNew).length);
    const discoveries = items.filter((item) => item.entry.isNew);
    if (discoveries.length <= open) {
      for (const item of discoveries) item.value += discoveryBonus;
    } else if (open > 0) {
      slots = open;
      for (const item of discoveries) item.tracksNew = true;
    }
  }
  const dayNums = [...new Set(items.flatMap((item) => item.days))].sort((a, b) => a - b);
  const n = dayNums.length;
  const indexOf = new Map(dayNums.map((day, index) => [day, index]));
  const weekOf = dayNums.map(weekIndex);
  const startsAt = dayNums.map(() => []);
  items.forEach((item, order) => {
    item.order = order;
    item.run = 1;
    while (item.run < item.days.length && item.days[item.run] === item.days[item.run - 1] + 1) item.run += 1;
    startsAt[indexOf.get(item.days[0])].push(item);
  });
  const words = Math.ceil(bonuses.length / BITS_PER_WORD);
  const openFrom = new Array(n + 1);
  const discoveriesFrom = new Int32Array(n + 1);
  openFrom[n] = new Array(words).fill(0);
  for (let index = n - 1; index >= 0; index -= 1) {
    const open = openFrom[index + 1].slice();
    discoveriesFrom[index] = discoveriesFrom[index + 1];
    for (const item of startsAt[index]) {
      for (const bit of item.features) open[Math.floor(bit / BITS_PER_WORD)] |= 1 << bit % BITS_PER_WORD;
      if (item.tracksNew) discoveriesFrom[index] += 1;
    }
    openFrom[index] = open;
  }
  const model = {
    n,
    dayNums,
    weekOf,
    startsAt,
    capacity: env.capacity,
    avoid: env.avoid,
    budgetLeft: env.budgetLeft,
    bonuses,
    words,
    slots,
    discoveryBonus,
    kindBonus,
    venueBonus,
    openFrom,
    discoveriesFrom
  };
  model.multipliers = budgeted ? budgetMultipliers(items, policy.budgetMultipliers) : [0];
  const lumpAll = new Array(words).fill(0);
  const lumpKinds = new Array(words).fill(0);
  bonuses.forEach((_, bit) => {
    lumpAll[Math.floor(bit / BITS_PER_WORD)] |= 1 << bit % BITS_PER_WORD;
    if (bit < venueBitsFrom) lumpKinds[Math.floor(bit / BITS_PER_WORD)] |= 1 << bit % BITS_PER_WORD;
  });
  for (const item of items) {
    item.perPick = item.features.reduce((sum, bit) => sum + (bit >= venueBitsFrom ? bonuses[bit] : 0), 0);
  }
  model.kindBits = lumpKinds;
  model.bounds = [{ lumps: lumpAll, tables: model.multipliers.map((multiplier) => relaxedTable(model, multiplier, false)) }];
  if (bonuses.length > venueBitsFrom) {
    model.bounds.push({ lumps: lumpKinds, tables: model.multipliers.map((multiplier) => relaxedTable(model, multiplier, true)) });
  }
  return model;
}
function budgetMultipliers(items, limit) {
  const ratios = [...new Set(items.filter((item) => item.cost > 0).map((item) => item.value / item.cost))].sort((a, b) => a - b);
  if (!ratios.length) return [0];
  const chosen = /* @__PURE__ */ new Set([0, ratios[ratios.length - 1] * (1 + 1e-9) + 1e-9]);
  if (ratios.length <= limit) {
    for (const ratio of ratios) chosen.add(ratio);
  } else {
    for (let step = 0; step < limit; step += 1) chosen.add(ratios[Math.floor((step + 0.5) * ratios.length / limit)]);
  }
  return [...chosen].sort((a, b) => a - b);
}
function relaxedTable(model, multiplier, perPick) {
  const { n, dayNums, weekOf, startsAt, capacity, avoid } = model;
  const table = new Float64Array((n + 1) * 16);
  for (let i = n - 1; i >= 0; i -= 1) {
    const sameWeekNext = i + 1 < n && weekOf[i + 1] === weekOf[i];
    for (let u = 0; u < 8; u += 1) {
      for (let p = 0; p < 2; p += 1) {
        let best = table[((i + 1) * 8 + (sameWeekNext ? u : 0)) * 2];
        if (!(avoid && p)) {
          for (const item of startsAt[i]) {
            const value = item.value + (perPick ? item.perPick : 0) - multiplier * item.cost;
            if (value <= 0) continue;
            let used = u;
            let fits = true;
            for (let step = 0; step < item.run && fits; step += 1) {
              if (step > 0 && weekOf[i + step] !== weekOf[i + step - 1]) used = 0;
              used += 1;
              fits = used <= capacity(weekOf[i + step]);
            }
            if (!fits) continue;
            const next = i + item.run;
            let after = 0;
            if (next < n) {
              const carried = weekOf[next] === weekOf[next - 1] ? used : 0;
              const adjacent = dayNums[next] === dayNums[next - 1] + 1 ? 1 : 0;
              after = table[(next * 8 + carried) * 2 + adjacent];
            }
            if (value + after > best) best = value + after;
          }
        }
        table[(i * 8 + u) * 2 + p] = best;
      }
    }
  }
  return table;
}
function search(model, nodeBudget, labelsPerState) {
  const { n, dayNums, weekOf, startsAt, capacity, avoid, bonuses, words, slots, discoveryBonus, kindBonus, venueBonus, kindBits, openFrom, discoveriesFrom, bounds, multipliers } = model;
  const tracksVariety = bonuses.length > 0 || slots > 0;
  const memo = /* @__PURE__ */ new Map();
  let best = 0;
  let bestChain = null;
  let nodes = 0;
  let exhausted = false;
  const worth = (word, bits) => bits ? bitCount(bits & kindBits[word]) * kindBonus + bitCount(bits & ~kindBits[word]) * venueBonus : 0;
  const claimsInWeek = (claims, week) => {
    let count = 0;
    for (const day of claims) if (weekIndex(day) === week) count += 1;
    return count;
  };
  const advance = (i, u, occupied, claims) => {
    for (; ; ) {
      const next = i + 1;
      if (next >= n) return { i: n, u: 0, p: 0, claims: NO_CLAIMS };
      const p = occupied && dayNums[next] === dayNums[i] + 1 ? 1 : 0;
      if (weekOf[next] !== weekOf[i]) u = claimsInWeek(claims, weekOf[next]);
      i = next;
      if (!claims.length || claims[0] !== dayNums[i]) return { i, u, p, claims };
      claims = claims.slice(1);
      occupied = true;
    }
  };
  const fits = (item, i, u, claims) => {
    for (const [week, count] of item.weeks) {
      const used = week === weekOf[i] ? u : claimsInWeek(claims, week);
      if (used + count > capacity(week)) return false;
    }
    for (const claim of claims) {
      for (const day of item.days) {
        const gap = claim - day;
        if (gap === 0 || avoid && (gap === 1 || gap === -1)) return false;
      }
    }
    return true;
  };
  const varietyLead = (i, aBits, aNew, bBits, bNew) => {
    let lead = aNew > bNew ? Math.min(aNew - bNew, discoveriesFrom[i]) * discoveryBonus : 0;
    const open = openFrom[i];
    for (let word = 0; word < words; word += 1) lead += worth(word, aBits[word] & ~bBits[word] & open[word]);
    return lead;
  };
  const ceiling = (state, left, bits, found) => {
    if (state.i >= n) return 0;
    const offset = (state.i * 8 + state.u) * 2 + state.p;
    const open = openFrom[state.i];
    let lowest = Infinity;
    for (const { tables, lumps } of bounds) {
      let bound = Infinity;
      for (let t = 0; t < tables.length; t += 1) {
        const value = tables[t][offset] + (multipliers[t] ? multipliers[t] * left : 0);
        if (value < bound) bound = value;
      }
      bound = Math.floor(bound + 1e-6);
      for (let word = 0; word < words; word += 1) bound += worth(word, open[word] & ~bits[word] & lumps[word]);
      if (bound < lowest) lowest = bound;
    }
    return lowest + (slots ? Math.min(slots - found, discoveriesFrom[state.i]) * discoveryBonus : 0);
  };
  const dominated = (state, left, bits, found, value) => {
    const key = state.claims.length ? `${state.i}|${state.u}|${state.p}|${state.claims.join(",")}` : (state.i * 8 + state.u) * 2 + state.p;
    const label = { value, left, bits, found };
    const seen = memo.get(key);
    if (!seen) {
      memo.set(key, [label]);
      return false;
    }
    for (const earlier of seen) {
      if (earlier.left >= left && earlier.value >= value && (!tracksVariety || earlier.value - varietyLead(state.i, earlier.bits, earlier.found, bits, found) >= value)) return true;
    }
    let kept = 0;
    for (const earlier of seen) {
      const beaten = left >= earlier.left && value >= earlier.value && (!tracksVariety || value - varietyLead(state.i, bits, found, earlier.bits, earlier.found) >= earlier.value);
      if (!beaten) seen[kept++] = earlier;
    }
    seen.length = kept;
    if (kept < labelsPerState) seen.push(label);
    return false;
  };
  const visit = (state, left, bits, found, value, chain) => {
    if (value > best) {
      best = value;
      bestChain = chain;
    }
    if (state.i >= n) return;
    if (nodes >= nodeBudget) {
      exhausted = true;
      return;
    }
    nodes += 1;
    if (dominated(state, left, bits, found, value)) return;
    const { i, u, p, claims } = state;
    const skipped = advance(i, u, false, claims);
    const options = [{ state: skipped, left, bits, found, value, chain, reach: value + ceiling(skipped, left, bits, found), order: Infinity }];
    if (!(avoid && p)) {
      for (const item of startsAt[i]) {
        if (item.cost > left || !fits(item, i, u, claims)) continue;
        let gain = item.value;
        let nextBits = bits;
        for (const bit of item.features) {
          const word = Math.floor(bit / BITS_PER_WORD);
          const mask = 1 << bit % BITS_PER_WORD;
          if (nextBits[word] & mask) continue;
          if (nextBits === bits) nextBits = bits.slice();
          nextBits[word] |= mask;
          gain += bonuses[bit];
        }
        let nextFound = found;
        if (item.tracksNew && found < slots) {
          nextFound += 1;
          gain += discoveryBonus;
        }
        const claimed = item.days.length > 1 ? [...claims, ...item.days.slice(1)].sort((a, b) => a - b) : claims;
        const next = advance(i, u + item.weeks[0][1], true, claimed);
        const nextLeft = left - item.cost;
        options.push({
          state: next,
          left: nextLeft,
          bits: nextBits,
          found: nextFound,
          value: value + gain,
          chain: { item, previous: chain },
          reach: value + gain + ceiling(next, nextLeft, nextBits, nextFound),
          order: item.order
        });
      }
    }
    options.sort((a, b) => b.reach - a.reach || a.order - b.order);
    for (const option of options) {
      if (option.reach <= best) break;
      visit(option.state, option.left, option.bits, option.found, option.value, option.chain);
      if (exhausted) return;
    }
  };
  if (n > 0) {
    const origin = { i: 0, u: 0, p: 0, claims: NO_CLAIMS };
    visit(origin, model.budgetLeft, words ? new Array(words).fill(0) : NO_BITS, 0, 0, null);
  }
  const entries = [];
  for (let link = bestChain; link; link = link.previous) entries.push(link.item.entry);
  return { entries: entries.reverse(), exact: !exhausted, nodes };
}
function bitCount(bits) {
  bits -= bits >>> 1 & 1431655765;
  bits = (bits & 858993459) + (bits >>> 2 & 858993459);
  return (bits + (bits >>> 4) & 252645135) * 16843009 >>> 24;
}
function describePlan(plan, { env, worthwhile, rules, policy }) {
  const { lens, picks } = plan;
  const pinnedIds = new Set(env.pinned.map((entry) => entry.id));
  const occupied = /* @__PURE__ */ new Map();
  for (const entry of picks) for (const day of entry.days) if (!occupied.has(day)) occupied.set(day, entry);
  const weekLoad = /* @__PURE__ */ new Map();
  for (const day of occupied.keys()) weekLoad.set(weekIndex(day), (weekLoad.get(weekIndex(day)) ?? 0) + 1);
  const knownCents = picks.reduce((sum, entry) => sum + (entry.cents ?? 0), 0);
  const hassle = picks.reduce((sum, entry) => sum + entry.hassle, 0);
  const pickedIds = new Set(picks.map((entry) => entry.id));
  const pickedListings = new Set(picks.map(listingKey));
  const facts = { lens, picks, pinnedIds, occupied, weekLoad, knownCents, env, rules, policy, exact: plan.exact };
  return {
    lens,
    label: LENS_COPY[lens].label,
    tagline: picks.length ? LENS_COPY[lens].tagline(rules.windowDays) : `Nothing fits the next ${rules.windowDays} days. Staying in is the plan.`,
    alsoLenses: plan.alsoLenses,
    picks: picks.map((entry) => ({ ...entry.candidate, pinned: pinnedIds.has(entry.id), why: whyPicked(entry, facts) })),
    totals: {
      score: round22(picks.reduce((sum, entry) => sum + entry.score, 0)),
      value: objectiveValue(lens, picks, policy) / UNIT,
      nights: occupied.size,
      knownCostUsd: knownCents / 100,
      unpricedCount: picks.filter((entry) => entry.cents == null).length,
      hassle: round22(hassle),
      averageHassle: picks.length ? round22(hassle / picks.length) : 0,
      verticals: { music: picks.filter((entry) => !entry.sports).length, sports: picks.filter((entry) => entry.sports).length },
      newCount: picks.filter((entry) => entry.isNew).length
    },
    gaveUp: worthwhile.filter((entry) => !pickedIds.has(entry.id)).filter((entry) => !pickedListings.has(listingKey(entry))).sort((left, right) => right.score - left.score || compareEntries(left, right)).slice(0, policy.gaveUpLimit).map((entry) => ({ id: entry.id, title: entry.title, startLocal: entry.startLocal, score: entry.score, reason: reasonLeftOut(entry, facts) })),
    versusBest: null,
    exact: plan.exact
  };
}
function listingKey(entry) {
  const title = String(entry.title ?? "").toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return `${title}|${entry.days[0]}`;
}
function whyPicked(entry, { lens, picks, pinnedIds, env, policy }) {
  if (pinnedIds.has(entry.id)) return "pinned: you saved this";
  const week = weekIndex(entry.first);
  const sameWeek = env.considered.filter((other) => weekIndex(other.first) === week);
  if (lens === "mix") {
    const kinds = new Set(picks.map((pick) => pick.kind));
    if (kinds.size > 1 && picks.filter((pick) => pick.kind === entry.kind).length === 1) return `adds ${kindLabel(entry)} to the mix`;
    const counted = picks.filter((pick) => pick.isNew).slice(0, policy.mix.discoveryLimit);
    if (counted.includes(entry)) return "adds a discovery to the mix";
  }
  if (lens === "easy" && !entry.isTrip) {
    const good = sameWeek.filter((other) => other.score > policy.bar);
    if (good.every((other) => other.hassle >= entry.hassle)) return "lowest-effort good night that week";
  }
  if (sameWeek.every((other) => other.score <= entry.score)) return "top score that week";
  const sameDay = env.considered.filter((other) => other !== entry && other.days.some((day) => entry.days.includes(day)));
  if (sameDay.length && sameDay.every((other) => other.score <= entry.score)) return "best option that night";
  return "fits around the rest of the plan";
}
function reasonLeftOut(entry, { lens, picks, occupied, weekLoad, knownCents, env, rules, policy, exact }) {
  if (entry.isTrip && !rules.includeTrips) return { kind: "trip", text: "Trips are turned off" };
  const single = entry.days.length === 1;
  const clash = picks.find((pick) => pick.days.some((day) => entry.days.includes(day)));
  if (clash) {
    return { kind: "same-day", withId: clash.id, text: `${single && clash.days.length === 1 ? "Same night as" : "Overlaps"} ${clash.title}` };
  }
  if (rules.avoidBackToBack) {
    const neighbour = picks.find((pick) => pick.days.some((day) => entry.days.includes(day - 1) || entry.days.includes(day + 1)));
    if (neighbour) return { kind: "back-to-back", withId: neighbour.id, text: `Back-to-back with ${neighbour.title}` };
  }
  for (const [week, count] of entry.weeks) {
    const total = (weekLoad.get(week) ?? 0) + count;
    if (total <= rules.nightsPerWeek) continue;
    const text = count === 1 && total < ORDINALS.length ? `Would be ${ORDINALS[total]} night that week` : `Would make ${total} nights that week, over your limit of ${rules.nightsPerWeek}`;
    return { kind: "weekly-cap", text };
  }
  if (env.budgetCents != null && (entry.cents ?? 0) > 0 && knownCents + entry.cents > env.budgetCents) {
    return { kind: "budget", text: `Would put the plan ${dollars(knownCents + entry.cents - env.budgetCents)} over budget` };
  }
  if (lens === "easy" && nightValue("easy", entry, policy) <= 0) {
    return { kind: "outweighed", text: entry.isTrip ? "A trip is more effort than it adds" : "More effort than it adds" };
  }
  return { kind: "outweighed", text: exact ? "Left out of this plan" : "Left out when the search stopped early" };
}
function kindLabel(entry) {
  if (!entry.sports) return "live music";
  if (entry.kind === "sports:nfl") return "football";
  if (entry.kind === "sports:mlb") return "baseball";
  return entry.kind.slice("sports:".length);
}
function dayNumber(value) {
  const match = DATE_PATTERN.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.round(date.getTime() / DAY_MS);
}
function dateKey(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
function weekIndex(day) {
  return Math.floor((day + 3) / 7);
}
function weekCounts(days) {
  const counts = /* @__PURE__ */ new Map();
  for (const day of days) counts.set(weekIndex(day), (counts.get(weekIndex(day)) ?? 0) + 1);
  return [...counts.entries()];
}
function uniqueDayNumbers(values) {
  return [...new Set(values.map(dayNumber).filter((day) => day != null))].sort((a, b) => a - b);
}
function todayNumber(now, timeZone = PLAN_POLICY.timeZone) {
  if (now == null) return null;
  if (typeof now === "string" && !/T.*(Z|[+-]\d{2}:?\d{2})$/i.test(now.trim())) return dayNumber(now.trim());
  const date = now instanceof Date ? now : new Date(typeof now === "string" ? now.trim() : now);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = {};
    for (const part of new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)) {
      parts[part.type] = part.value;
    }
    return dayNumber(`${parts.year}-${parts.month}-${parts.day}`);
  } catch {
    return null;
  }
}
function plainNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return NaN;
}
function idSet(ids) {
  return new Set((Array.isArray(ids) ? ids : []).filter((id) => id != null).map(String));
}
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function compareEntries(left, right) {
  return left.first - right.first || compareText(left.id, right.id);
}
function round22(value) {
  return Math.round(value * 100) / 100;
}
function dollars(cents) {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

// ../src/evidenceGraph.js
var GRAPH_POLICY = Object.freeze({
  version: 1,
  // Each hop after the first multiplies a path's strength by this.
  hopAttenuation: 0.85,
  // A node rated poorly multiplies every path through it by 1 - penalty * aversion.
  aversionPenalty: 0.8,
  weights: Object.freeze({
    listensCore: 1,
    listens: 0.85,
    nearSimilar: 0.55,
    nearTag: 0.4,
    followsPromoter: 0.6,
    followsTeam: 0.7,
    watching: 0.9,
    playsPrimary: 1,
    playsSupport: 0.8,
    at: 1,
    presents: 1,
    rosters: 0.7,
    // One upcoming night for a promoter; more nights combine as 1 - (1 - books)^n.
    books: 0.5,
    hosts: 1,
    visits: 1,
    isA: 0.6
  }),
  // A learned taste score in [-1, 1]. Above minScore it becomes an edge of
  // weight base + scale * score; below -minScore it becomes an aversion.
  learned: Object.freeze({ minScore: 0.05, base: 0.35, scale: 0.65 }),
  // One shared bill of n artists contributes base / sqrt(n - 1); a b2b pair
  // contributes at least b2b. Bills combine as 1 - prod(1 - c). Pairs below
  // minWeight (one festival-sized bill) are not emitted.
  sharedBill: Object.freeze({ base: 0.6, b2b: 0.8, minWeight: 0.1 }),
  paths: Object.freeze({ maxPaths: 4, maxHops: 4, hardMaxHops: 5, minStrength: 0.05 }),
  scenes: Object.freeze({
    minTie: 0.25,
    minArtists: 2,
    maxArtists: 16,
    maxArtistsListed: 12,
    maxBridges: 6,
    maxBridgesPerAnchor: 2,
    promoterBridge: 0.5,
    venueBridge: 0.5,
    nearBridge: 0.5,
    dominantShare: 0.5
  }),
  constellation: Object.freeze({
    maxNewPerEvent: 3,
    minEventGap: 0.12,
    minOuterGap: 0.06,
    indirectPull: 0.5,
    adjacentWeight: 0.5,
    newWeight: 0.35
  })
});
var TWO_PI = Math.PI * 2;
var DIRECT_ORIGINS = ["source", "top-items"];
var TIER_ORIGINS = {
  direct: DIRECT_ORIGINS,
  similar: ["similar"],
  tag: ["tag"],
  roster: ["promoter"],
  "promoter-night": ["promoter"]
};
var LEARNED_NODE_CATEGORIES = ["artist", "venue", "promoter", "opponent"];
function buildEvidenceGraph({ events = [], sports = [], tasteProfile = null, signals = null, now = null } = {}) {
  const W = GRAPH_POLICY.weights;
  const today = localDateKey2(now);
  const nodes = /* @__PURE__ */ new Map([["you", { id: "you", kind: "you", label: "You" }]]);
  const edges = /* @__PURE__ */ new Map();
  const put = (id, fields) => {
    if (!nodes.has(id)) nodes.set(id, { id, ...fields });
    return nodes.get(id);
  };
  const link = (from, to, kind, weight, evidence, extra = {}) => {
    const key = `${kind}|${from}|${to}`;
    const current = edges.get(key);
    if (!current || weight > current.weight) edges.set(key, { from, to, kind, weight: round3(clamp(weight)), evidence, ...extra });
  };
  const artists = /* @__PURE__ */ new Map();
  const seeArtist = (name, rank) => {
    const label = clean(name);
    const key = normalizeArtistName(label);
    if (!key) return null;
    const id = `artist:${key}`;
    const artist = artists.get(id) ?? { id, label, rank, direct: false, core: false, similar: false, tag: false, promoter: false, adjacent: false };
    const better = rank - artist.rank || label.length - artist.label.length || cmp(label, artist.label);
    if (better < 0) Object.assign(artist, { label, rank });
    artists.set(id, artist);
    return artist;
  };
  const promoterNode = (name) => {
    const label = clean(name);
    const key = normalizeArtistName(label);
    if (!key) return null;
    return put(`promoter:${key}`, { kind: "promoter", label, followed: PROMOTER_SOURCES.includes(key) });
  };
  const venueNode = (row) => {
    const name = clean(row.venue?.name);
    const key = normalizeArtistName(`${name} ${row.venue?.city ?? ""}`);
    if (!name || !key) return null;
    const city = clean(row.venue?.city);
    return put(frozenKey(row, "venue") ?? `venue:${key}`, { kind: "venue", label: name, ...city ? { city } : {} });
  };
  const shapes = /* @__PURE__ */ new Map();
  const noteShape = (key, label, memberId) => {
    if (!key) return;
    const shape = shapes.get(key) ?? { label, members: [] };
    shape.members.push(memberId);
    shapes.set(key, shape);
  };
  const pairs = /* @__PURE__ */ new Map();
  const bookings = /* @__PURE__ */ new Map();
  for (const row of liveRows(events, today)) {
    const eventId = `event:${row.id}`;
    const destination = row.destination && typeof row.destination === "object" ? clean(row.destination.name) || clean(row.title) : null;
    put(eventId, {
      kind: "event",
      label: clean(row.title) || "Untitled night",
      eventId: row.id,
      startLocal: clean(row.startLocal),
      score: finite(row.ranking?.utility),
      ...row.eventType ? { shape: clean(row.eventType) } : {},
      ...destination ? { destination } : {}
    });
    if (destination) link("you", eventId, "watching", W.watching, "on your destination watchlist");
    const bill = /* @__PURE__ */ new Map();
    const billed = (name, rank, primary) => {
      const artist = seeArtist(name, rank);
      if (artist) bill.set(artist.id, Boolean(primary) || Boolean(bill.get(artist.id)));
      return artist;
    };
    for (const performer of list(row.performers)) billed(performer?.name, 1, performer?.primary);
    for (const match of list(row.matchedArtists)) {
      const artist = billed(match?.name, 0, match?.primary);
      if (!artist) continue;
      const origin = match.origin ?? "source";
      if (DIRECT_ORIGINS.includes(origin)) artist.direct = true;
      else if (origin === "similar" || origin === "tag" || origin === "promoter") artist[origin] = true;
      else artist.adjacent = true;
    }
    const lineup = list(row.lineupDisplay?.orderedArtists);
    const tiered = lineup.some((entry) => Number(entry?.billingGroupIndex) > 0);
    const b2b = /* @__PURE__ */ new Set();
    lineup.forEach((entry, position) => {
      const artist = billed(entry?.displayName, 2, tiered && Number(entry?.billingGroupIndex) === 0);
      if (!artist) return;
      if (entry.relation === "direct") artist.direct = true;
      else if (entry.relation === "adjacent") artist.adjacent = true;
      const next = entry.b2bWithNext ? normalizeArtistName(lineup[position + 1]?.displayName) : "";
      if (next && `artist:${next}` !== artist.id) b2b.add(pairKey(artist.id, `artist:${next}`));
    });
    const ids = [...bill.keys()].sort();
    for (const id of ids) link(id, eventId, "plays", bill.get(id) ? W.playsPrimary : W.playsSupport, bill.get(id) ? "headliner" : "on the bill");
    if (ids.length > 1) {
      const share = GRAPH_POLICY.sharedBill.base / Math.sqrt(ids.length - 1);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const key = pairKey(ids[i], ids[j]);
          const pair = pairs.get(key) ?? { from: ids[i], to: ids[j], miss: 1, count: 0 };
          pair.miss *= 1 - (b2b.has(key) ? Math.max(share, GRAPH_POLICY.sharedBill.b2b) : share);
          pair.count += 1;
          pairs.set(key, pair);
        }
      }
    }
    const venue = venueNode(row);
    if (venue) link(eventId, venue.id, "at", W.at, "venue");
    const discovery = row.ranking?.discovery ?? {};
    const sources = new Set([...list(row.sources), row.source].filter(Boolean));
    const presenting = [
      ...list(row.promoters),
      discovery.promoterShow,
      ...PROMOTER_SOURCES.filter((source) => sources.has(source)).map((source) => source[0].toUpperCase() + source.slice(1))
    ];
    const presenters = /* @__PURE__ */ new Set();
    for (const name of presenting) {
      const promoter = promoterNode(name);
      if (!promoter) continue;
      presenters.add(promoter.id);
      link(promoter.id, eventId, "presents", W.presents, "presents this night");
    }
    for (const promoter of presenters) {
      for (const id of ids) {
        const key = `${promoter}|${id}`;
        bookings.set(key, { from: promoter, to: id, count: (bookings.get(key)?.count ?? 0) + 1 });
      }
    }
    const roster = discovery.rosterPromoter ? promoterNode(discovery.rosterPromoter) : null;
    const origins = TIER_ORIGINS[discovery.tier];
    if (roster && origins) {
      const pool = new Set(list(row.matchedArtists).filter((match) => origins.includes(match?.origin ?? "source")).map((match) => normalizeArtistName(match?.name)).filter(Boolean));
      if (pool.size === 1) link(roster.id, `artist:${[...pool][0]}`, "rosters", W.rosters, "on the roster");
    }
    const shape = normalizeArtistName(row.eventType);
    const shapeLabel = row.eventType === "dj set" ? "DJ sets" : `${clean(row.eventType)}s`;
    noteShape(frozenKey(row, "shape") ?? (shape ? `shape:${shape}` : null), frozenLabel(row, "shape") ?? shapeLabel, eventId);
  }
  for (const row of liveRows(sports, today)) {
    const gameId = `game:${row.id}`;
    const home = clean(row.homeTeam?.name ?? row.homeTeam?.shortName);
    const away = clean(row.awayTeam?.name ?? row.awayTeam?.shortName);
    const league = clean(row.league ?? row.sportsContext?.league);
    put(gameId, {
      kind: "game",
      label: [away, home].filter(Boolean).join(" at ") || "Home game",
      eventId: row.id,
      startLocal: clean(row.startLocal),
      score: finite(row.ranking?.utility),
      ...league ? { league } : {}
    });
    const homeKey = normalizeArtistName(home);
    if (homeKey) {
      const team = put(`team:${homeKey}`, { kind: "team", label: home });
      link(team.id, gameId, "hosts", W.hosts, "home game");
      link("you", team.id, "follows", W.followsTeam, "home team");
    }
    const awayKey = normalizeArtistName(away);
    if (awayKey) {
      const opponent = put(`opponent:${awayKey}`, { kind: "opponent", label: away });
      link(opponent.id, gameId, "visits", W.visits, "visiting");
    }
    const venue = venueNode(row);
    if (venue) link(gameId, venue.id, "at", W.at, "venue");
    const football = league === "nfl" || String(row.id).startsWith("nfl:");
    noteShape(frozenKey(row, "shape") ?? `shape:${football ? "football" : "baseball"}`, frozenLabel(row, "shape") ?? (football ? "Rams games" : "Dodgers games"), gameId);
  }
  for (const top of list(tasteProfile?.topArtists)) {
    if (!DIRECT_ORIGINS.includes(top?.origin ?? "source")) continue;
    const artist = seeArtist(top?.name, 0);
    if (artist) Object.assign(artist, { direct: true, core: true });
  }
  for (const artist of artists.values()) {
    const relation = artist.direct ? "direct" : artist.similar || artist.tag || artist.promoter || artist.adjacent ? "adjacent" : "new";
    const via = relation !== "adjacent" ? null : artist.similar ? "similar" : artist.tag ? "tag" : artist.promoter ? "promoter" : null;
    put(artist.id, { kind: "artist", label: artist.label, relation, ...via ? { via } : {} });
    if (relation === "direct") link("you", artist.id, "listens", artist.core ? W.listensCore : W.listens, artist.core ? "a core artist in your profile" : "in your rotation");
    else if (via === "similar") link("you", artist.id, "near", W.nearSimilar, "similar to artists you play");
    else if (via === "tag") link("you", artist.id, "near", W.nearTag, "in a tag cluster you play");
  }
  for (const node of nodes.values()) {
    if (node.kind === "promoter" && node.followed) link("you", node.id, "follows", W.followsPromoter, "a promoter you follow");
  }
  for (const booking of bookings.values()) {
    link(booking.from, booking.to, "books", 1 - (1 - W.books) ** booking.count, `${booking.count} upcoming night${booking.count === 1 ? "" : "s"}`, { count: booking.count });
  }
  for (const pair of pairs.values()) {
    const weight = 1 - pair.miss;
    if (weight >= GRAPH_POLICY.sharedBill.minWeight) {
      link(pair.from, pair.to, "shares-bill", weight, `${pair.count} shared bill${pair.count === 1 ? "" : "s"}`, { count: pair.count });
    }
  }
  for (const [key, signal] of entriesOf(signals?.taste)) {
    const score = Number(signal?.score);
    if (!Number.isFinite(score) || Math.abs(score) < GRAPH_POLICY.learned.minScore) continue;
    const category = String(key).slice(0, String(key).indexOf(":"));
    let target = LEARNED_NODE_CATEGORIES.includes(category) && nodes.has(key) ? nodes.get(key) : null;
    if (category === "shape" && score > 0 && shapes.has(key)) {
      const shape = shapes.get(key);
      target = put(key, { kind: "shape", label: clean(signal.label) || shape.label });
      for (const member of shape.members) link(member, key, "is-a", GRAPH_POLICY.weights.isA, "kind of night");
    }
    if (!target || target.kind !== category) continue;
    if (score > 0) {
      const outcomes = Number.isInteger(signal.outcomes) && signal.outcomes > 0 ? signal.outcomes : null;
      link(
        "you",
        target.id,
        "learned",
        GRAPH_POLICY.learned.base + GRAPH_POLICY.learned.scale * Math.min(1, score),
        outcomes ? `learned from ${outcomes} outcome${outcomes === 1 ? "" : "s"}` : "learned from your feedback"
      );
    } else {
      target.aversion = round3(Math.min(1, -score));
    }
  }
  const sortedNodes = [...nodes.values()].sort((a, b) => a.id === "you" ? -1 : b.id === "you" ? 1 : cmp(a.id, b.id));
  const sortedEdges = [...edges.values()].filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)).sort((a, b) => cmp(a.kind, b.kind) || cmp(a.from, b.from) || cmp(a.to, b.to));
  return { policyVersion: GRAPH_POLICY.version, nodes: sortedNodes, edges: sortedEdges, index: buildIndex(sortedNodes, sortedEdges) };
}
function connectionPaths(graph, eventId, { maxPaths = GRAPH_POLICY.paths.maxPaths, maxHops = GRAPH_POLICY.paths.maxHops } = {}) {
  const target = resolveEvent(graph, eventId);
  if (!target || !(maxPaths > 0)) return [];
  const { nodes, edges, index } = graph;
  const limit = Math.min(Math.floor(maxHops), GRAPH_POLICY.paths.hardMaxHops);
  if (!(limit >= 1)) return [];
  const best = /* @__PURE__ */ new Map();
  const record = (chain, trail, anchor) => {
    const ids = ["you", ...[...chain].reverse(), target.id];
    const used = [anchor, ...[...trail].reverse()];
    let strength = GRAPH_POLICY.hopAttenuation ** (used.length - 1);
    for (const i of used) strength *= edges[i].weight;
    for (const id of chain) strength *= 1 - GRAPH_POLICY.aversionPenalty * (nodes[index.byId[id]].aversion ?? 0);
    if (!(strength >= GRAPH_POLICY.paths.minStrength)) return;
    const key = `${chain[chain.length - 1]}|${chain[0]}`;
    const signature = ids.join(">");
    const current = best.get(key);
    if (!current || strength > current.strength || strength === current.strength && signature < current.signature) {
      best.set(key, { strength, ids, used, signature });
    }
  };
  const onBill = /* @__PURE__ */ new Set();
  const presenters = /* @__PURE__ */ new Set();
  const entries = [];
  for (const i of index.in[target.id] ?? []) {
    const edge = edges[i];
    if (edge.from === "you") {
      best.set("you", { strength: edge.weight, ids: ["you", target.id], used: [i], signature: `you>${target.id}` });
    } else {
      entries.push([edge.from, i]);
      if (edge.kind === "plays") onBill.add(edge.from);
      if (edge.kind === "presents") presenters.add(edge.from);
    }
  }
  for (const i of index.out[target.id] ?? []) entries.push([edges[i].to, i]);
  const walk = (id, chain, trail) => {
    const hops = trail.length;
    const anchor = index.anchor[id];
    if (anchor !== void 0 && hops + 1 <= limit) record(chain, trail, anchor);
    if (hops + 2 > limit || nodes[index.byId[id]].kind !== "artist") return;
    for (const i of index.in[id] ?? []) {
      const edge = edges[i];
      if (edge.kind !== "rosters" && edge.kind !== "books" || chain.includes(edge.from)) continue;
      if (edge.kind === "books" && presenters.has(edge.from)) continue;
      const followed = index.anchor[edge.from];
      if (followed !== void 0) record([...chain, edge.from], [...trail, i], followed);
    }
    for (const i of (hops + 2 === limit ? index.anchoredBill[id] : index.bill[id]) ?? []) {
      const edge = edges[i];
      const next = edge.from === id ? edge.to : edge.from;
      if (onBill.has(next) || chain.includes(next)) continue;
      walk(next, [...chain, next], [...trail, i]);
    }
  };
  for (const [id, i] of entries) walk(id, [id], [i]);
  const taken = /* @__PURE__ */ new Set();
  const chosen = [];
  const ranked = [...best.values()].sort((a, b) => b.strength - a.strength || a.ids.length - b.ids.length || cmp(a.signature, b.signature));
  for (const path of ranked) {
    const interior = path.ids.slice(1, -1);
    if (interior.some((id) => taken.has(id))) continue;
    for (const id of interior) taken.add(id);
    const hops = path.ids.map((id, position) => {
      const node = nodes[index.byId[id]];
      return { nodeId: id, label: node.label, nodeKind: node.kind, via: position ? edges[path.used[position - 1]].kind : null };
    });
    chosen.push({ strength: round3(path.strength), ...describePath(hops, nodes[index.byId[target.id]]), hops });
    if (chosen.length >= maxPaths) break;
  }
  return chosen;
}
function findScenes(graph, { minEvents = 2, maxScenes = 6 } = {}) {
  if (!graph?.nodes?.length || !(maxScenes > 0)) return [];
  const S = GRAPH_POLICY.scenes;
  const { nodes, edges, index } = graph;
  const nodeOf = (id) => nodes[index.byId[id]];
  const anchorOf = (id) => index.anchor[id] === void 0 ? null : edges[index.anchor[id]];
  const isKnown = (node) => node.relation === "direct" || anchorOf(node.id)?.kind === "learned";
  const nightsOf = (id) => (index.out[id] ?? []).map((i) => edges[i]).filter((edge) => edge.kind === "plays" && nodeOf(edge.to).kind === "event").map((edge) => edge.to);
  const contexts = /* @__PURE__ */ new Map();
  const contextOf = (eventId) => {
    if (!contexts.has(eventId)) {
      contexts.set(eventId, {
        venue: (index.out[eventId] ?? []).map((i) => edges[i]).find((edge) => edge.kind === "at")?.to ?? null,
        promoters: (index.in[eventId] ?? []).map((i) => edges[i]).filter((edge) => edge.kind === "presents").map((edge) => edge.from)
      });
    }
    return contexts.get(eventId);
  };
  const members = nodes.filter((node) => node.kind === "artist" && !isKnown(node) && !node.aversion && nightsOf(node.id).length).map((node) => node.id);
  const parent = new Map(members.map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };
  const union = (a, b) => {
    const [low, high] = [find(a), find(b)].sort();
    if (low !== high) parent.set(high, low);
  };
  for (const edge of edges) {
    if (edge.kind === "shares-bill" && edge.weight >= S.minTie && parent.has(edge.from) && parent.has(edge.to)) union(edge.from, edge.to);
  }
  const rooms = /* @__PURE__ */ new Map();
  const roomsOf = /* @__PURE__ */ new Map();
  for (const id of members) {
    const counts = /* @__PURE__ */ new Map();
    for (const eventId of nightsOf(id)) {
      const context = contextOf(eventId);
      for (const promoter of context.promoters) {
        const room = `${promoter}|${context.venue ?? ""}`;
        counts.set(room, (counts.get(room) ?? 0) + 1);
        if (!rooms.has(room)) rooms.set(room, id);
        union(rooms.get(room), id);
      }
    }
    roomsOf.set(id, counts);
  }
  const components = /* @__PURE__ */ new Map();
  for (const id of members) components.set(find(id), [...components.get(find(id)) ?? [], id]);
  const groups = [];
  for (const ids of components.values()) {
    if (ids.length <= S.maxArtists) {
      groups.push(ids);
      continue;
    }
    const inside = new Set(ids);
    const dominant = new Map(ids.map((id) => [id, [...roomsOf.get(id).entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0] ?? null]));
    const split = /* @__PURE__ */ new Map();
    for (const id of ids) {
      let key = dominant.get(id);
      if (!key) {
        const ties = (index.bill[id] ?? []).map((i) => edges[i]).map((edge) => ({ other: edge.from === id ? edge.to : edge.from, weight: edge.weight })).filter((tie) => tie.weight >= S.minTie && inside.has(tie.other) && dominant.get(tie.other)).sort((a, b) => b.weight - a.weight || cmp(a.other, b.other));
        key = ties.length ? dominant.get(ties[0].other) : `bill:${ids[0]}`;
      }
      split.set(key, [...split.get(key) ?? [], id]);
    }
    groups.push(...split.values());
  }
  const scenes = [];
  for (const ids of groups) {
    if (ids.length < S.minArtists) continue;
    const nights = /* @__PURE__ */ new Map();
    const appearances = /* @__PURE__ */ new Map();
    const bridges = /* @__PURE__ */ new Map();
    const bridge = (anchorId, from, to, via, strength) => {
      const key = `${anchorId}|${to}|${via}`;
      if (!bridges.has(key) || strength > bridges.get(key).strength) bridges.set(key, { anchorId, from, to, via, strength });
    };
    for (const id of ids) {
      const member = nodeOf(id);
      const near = anchorOf(id);
      if (near?.kind === "near") bridge("you", "Your listening", member.label, member.via === "tag" ? "tag cluster" : "similar artist", near.weight * S.nearBridge);
      for (const i of index.anchoredBill[id] ?? []) {
        const edge = edges[i];
        const other = nodeOf(edge.from === id ? edge.to : edge.from);
        if (isKnown(other) && !other.aversion) bridge(other.id, other.label, member.label, "shared bill", anchorOf(other.id).weight * edge.weight);
      }
      for (const i of index.in[id] ?? []) {
        const edge = edges[i];
        const followed = edge.kind === "rosters" ? anchorOf(edge.from) : null;
        if (followed) bridge(edge.from, nodeOf(edge.from).label, member.label, "roster", followed.weight * edge.weight);
      }
      for (const eventId of nightsOf(id)) {
        nights.set(eventId, nodeOf(eventId));
        appearances.set(id, (appearances.get(id) ?? 0) + 1);
        const context = contextOf(eventId);
        for (const promoter2 of context.promoters) {
          const followed = anchorOf(promoter2);
          if (followed && !nodeOf(promoter2).aversion) bridge(promoter2, nodeOf(promoter2).label, member.label, "promoter night", followed.weight * S.promoterBridge);
        }
        const liked = context.venue ? anchorOf(context.venue) : null;
        if (liked) bridge(context.venue, nodeOf(context.venue).label, member.label, "venue", liked.weight * S.venueBridge);
      }
    }
    if (nights.size < minEvents || !bridges.size) continue;
    const ranked = [...bridges.values()].sort((a, b) => b.strength - a.strength || cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.via, b.via));
    const perAnchor = /* @__PURE__ */ new Map();
    for (const item of ranked) perAnchor.set(item.anchorId, Math.max(perAnchor.get(item.anchorId) ?? 0, item.strength));
    const bridgeStrength = 1 - [...perAnchor.values()].reduce((miss, strength) => miss * (1 - Math.min(1, strength)), 1);
    const shown = [];
    const shownPerAnchor = /* @__PURE__ */ new Map();
    for (const item of ranked) {
      const count = shownPerAnchor.get(item.anchorId) ?? 0;
      if (count >= S.maxBridgesPerAnchor || shown.length >= S.maxBridges) continue;
      shownPerAnchor.set(item.anchorId, count + 1);
      shown.push({ from: item.from, to: item.to, via: item.via, strength: round3(item.strength) });
    }
    const tally = (pick) => {
      const counts = /* @__PURE__ */ new Map();
      for (const eventId of nights.keys()) for (const id of pick(contextOf(eventId))) counts.set(id, (counts.get(id) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
    };
    const promoters = tally((context) => context.promoters);
    const venues = tally((context) => context.venue ? [context.venue] : []);
    const needed = Math.max(2, Math.ceil(nights.size * S.dominantShare));
    const promoter = promoters[0]?.[1] >= needed ? nodeOf(promoters[0][0]).label : null;
    const venue = venues[0]?.[1] >= needed ? nodeOf(venues[0][0]).label : null;
    const bridgeArtist = ranked.find((item) => item.via === "shared bill");
    const lead = [...ids].sort((a, b) => appearances.get(b) - appearances.get(a) || cmp(a, b))[0];
    const [label, basis] = promoter && venue ? [`${promoter} at ${venue}`, "promoter-venue"] : promoter ? [`${promoter} nights`, "promoter"] : venue ? [`Nights at ${venue}`, "venue"] : bridgeArtist ? [`Around ${bridgeArtist.from}`, "bridge-artist"] : [`Around ${nodeOf(lead).label}`, "adjacent-artist"];
    const knownIds = [...new Set(ranked.filter((item) => item.via === "shared bill").map((item) => item.anchorId))];
    const listed = [
      ...knownIds.map((id) => ({ node: nodeOf(id), known: true, nights: 0 })),
      ...ids.map((id) => ({ node: nodeOf(id), known: false, nights: appearances.get(id) }))
    ].sort((a, b) => Number(b.known) - Number(a.known) || b.nights - a.nights || cmp(a.node.label, b.node.label) || cmp(a.node.id, b.node.id));
    scenes.push({
      id: `scene:${ids[0].slice("artist:".length)}`,
      label,
      basis,
      artists: listed.slice(0, S.maxArtistsListed).map((item) => ({ name: item.node.label, relation: item.node.relation, known: item.known })),
      events: [...nights.values()].sort(byScore).map((node) => ({ id: node.eventId, title: node.label, startLocal: node.startLocal, score: node.score })),
      venues: venues.map(([id]) => nodeOf(id).label),
      promoters: promoters.map(([id]) => nodeOf(id).label),
      bridges: shown,
      knownCount: knownIds.length,
      newCount: ids.length,
      strength: round3(nights.size * bridgeStrength)
    });
  }
  scenes.sort((a, b) => b.strength - a.strength || b.events.length - a.events.length || cmp(a.id, b.id));
  const labels = /* @__PURE__ */ new Map();
  return scenes.slice(0, maxScenes).map((scene) => {
    const seen = (labels.get(scene.label) ?? 0) + 1;
    labels.set(scene.label, seen);
    return seen === 1 ? scene : { ...scene, label: `${scene.label} (${seen})` };
  });
}
function constellation(graph, { maxEvents = 40, includeGames = false } = {}) {
  const you = { id: "you", kind: "you", label: "You", ring: 0, angle: 0, weight: 1 };
  if (!graph?.nodes?.length) return { nodes: [you], links: [] };
  const C = GRAPH_POLICY.constellation;
  const { nodes, edges, index } = graph;
  const nodeOf = (id) => nodes[index.byId[id]];
  const likedBy = (id) => {
    const edge = index.anchor[id] === void 0 ? null : edges[index.anchor[id]];
    return edge && edge.kind !== "near" ? edge : null;
  };
  const picked = nodes.filter((node) => node.kind === "event" || includeGames && node.kind === "game").sort(byScore).slice(0, Math.max(0, Math.floor(maxEvents)));
  const links = /* @__PURE__ */ new Map();
  const addLink = (from, to, kind, weight) => {
    const key = `${from}|${to}|${kind}`;
    if (!links.has(key) || weight > links.get(key).weight) links.set(key, { from, to, kind, weight });
  };
  const pulls = /* @__PURE__ */ new Map();
  const outer = /* @__PURE__ */ new Map();
  for (const event of picked) {
    const pull = /* @__PURE__ */ new Map();
    const tug = (id, weight) => pull.set(id, Math.max(pull.get(id) ?? 0, weight));
    const onBill = /* @__PURE__ */ new Set();
    const presenters = /* @__PURE__ */ new Set();
    const unknown = [];
    const around = [
      ...(index.in[event.id] ?? []).map((i) => [edges[i].from, edges[i]]),
      ...(index.out[event.id] ?? []).map((i) => [edges[i].to, edges[i]])
    ];
    for (const [id, edge] of around) {
      if (edge.kind === "plays") onBill.add(id);
      if (edge.kind === "presents") presenters.add(id);
      if (id === "you") {
        addLink("you", event.id, edge.kind, edge.weight);
        continue;
      }
      const liked = likedBy(id);
      if (liked) {
        tug(id, liked.weight * edge.weight);
        addLink(id, event.id, edge.kind, edge.weight);
      } else if (edge.kind === "plays") {
        unknown.push({ id, weight: edge.weight, node: nodeOf(id) });
      }
    }
    unknown.sort((a, b) => b.weight - a.weight || cmp(a.node.relation, b.node.relation) || cmp(a.node.label, b.node.label) || cmp(a.id, b.id));
    for (const artist of unknown.slice(0, C.maxNewPerEvent)) {
      outer.set(artist.id, [...outer.get(artist.id) ?? [], { event, weight: artist.weight }]);
      addLink(artist.id, event.id, "plays", artist.weight);
      for (const i of index.anchoredBill[artist.id] ?? []) {
        const edge = edges[i];
        const other = edge.from === artist.id ? edge.to : edge.from;
        const liked = likedBy(other);
        if (!liked || onBill.has(other)) continue;
        tug(other, liked.weight * edge.weight * artist.weight * C.indirectPull);
        addLink(other, artist.id, "shares-bill", edge.weight);
      }
      for (const i of index.in[artist.id] ?? []) {
        const edge = edges[i];
        const liked = edge.kind === "rosters" || edge.kind === "books" ? likedBy(edge.from) : null;
        if (!liked || presenters.has(edge.from)) continue;
        tug(edge.from, liked.weight * edge.weight * artist.weight * C.indirectPull);
        addLink(edge.from, artist.id, edge.kind, edge.weight);
      }
    }
    pulls.set(event.id, pull);
  }
  const totals = /* @__PURE__ */ new Map();
  for (const pull of pulls.values()) for (const [id, weight] of pull) totals.set(id, (totals.get(id) ?? 0) + weight);
  const anchors = [...totals.keys()].sort();
  const affinity = (a, b) => {
    let sum = 0;
    for (const pull of pulls.values()) if (pull.has(a) && pull.has(b)) sum += Math.min(pull.get(a), pull.get(b));
    return sum;
  };
  const strongest = (ids) => [...ids].sort((a, b) => totals.get(b) - totals.get(a) || cmp(a, b))[0];
  const order = [];
  const waiting = new Set(anchors);
  while (waiting.size) {
    const last = order[order.length - 1];
    let next = null;
    let bestAffinity = 0;
    if (last) {
      for (const id of anchors) {
        if (!waiting.has(id)) continue;
        const value = affinity(last, id);
        if (value > bestAffinity) [next, bestAffinity] = [id, value];
      }
    }
    next ??= strongest(waiting);
    order.push(next);
    waiting.delete(next);
  }
  const angles = new Map(order.map((id, position) => [id, TWO_PI * position / order.length]));
  for (const id of order) addLink("you", id, likedBy(id).kind, likedBy(id).weight);
  const pulled = new Map(picked.map((event) => [
    event.id,
    circularMean([...pulls.get(event.id)].sort((a, b) => cmp(a[0], b[0])).map(([id, weight]) => [angles.get(id), weight]))
  ]));
  const adrift = picked.filter((event) => pulled.get(event.id) === null).sort((a, b) => cmp(a.startLocal, b.startLocal) || cmp(a.id, b.id));
  const eventAngles = spread(picked.map((event) => ({
    id: event.id,
    angle: pulled.get(event.id) ?? TWO_PI * (adrift.indexOf(event) + 0.5) / adrift.length
  })), C.minEventGap);
  const outerIds = [...outer.keys()].sort();
  const outerAngles = spread(outerIds.map((id) => ({
    id,
    angle: circularMean(outer.get(id).map(({ event, weight }) => [eventAngles.get(event.id), weight])) ?? 0
  })), C.minOuterGap);
  const byAngle = (map) => (a, b) => map.get(a.id) - map.get(b.id) || cmp(a.id, b.id);
  const out = [
    you,
    ...order.map((id) => nodeOf(id)).map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      ring: 1,
      angle: round3(angles.get(node.id), 6),
      weight: likedBy(node.id).weight,
      ...node.relation ? { relation: node.relation } : {}
    })),
    ...[...picked].sort(byAngle(eventAngles)).map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      ring: 2,
      angle: round3(eventAngles.get(node.id), 6),
      weight: round3(clamp(node.score / 100)),
      eventId: node.eventId
    })),
    ...outerIds.map((id) => nodeOf(id)).sort(byAngle(outerAngles)).map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      ring: 3,
      angle: round3(outerAngles.get(node.id), 6),
      weight: node.relation === "adjacent" ? C.adjacentWeight : C.newWeight,
      relation: node.relation,
      eventId: outer.get(node.id).map((item) => item.event).sort(byScore)[0].eventId
    }))
  ];
  return { nodes: out, links: [...links.values()].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind)) };
}
function describeNode(graph, nodeId) {
  const position = graph?.index?.byId?.[nodeId];
  if (position === void 0) return null;
  const { nodes, edges, index } = graph;
  const node = nodes[position];
  const nodeOf = (id) => nodes[index.byId[id]];
  const outgoing = (kind) => (index.out[node.id] ?? []).map((i) => edges[i]).filter((edge) => edge.kind === kind);
  const incoming = (kind) => (index.in[node.id] ?? []).map((i) => edges[i]).filter((edge) => edge.kind === kind);
  const anchor = index.anchor[node.id] === void 0 ? null : edges[index.anchor[node.id]];
  const learned = incoming("learned").length > 0;
  const count = (n, one, many = `${one}s`) => `${n} upcoming ${n === 1 ? one : many}`;
  const rated = (subject) => learned ? ` You have rated ${subject} well.` : node.aversion ? ` You have rated ${subject} poorly.` : "";
  let nights = [];
  let summary = "";
  if (node.kind === "you") {
    nights = outgoing("watching").map((edge) => nodeOf(edge.to));
    const listens = outgoing("listens").filter((edge) => (index.out[edge.to] ?? []).some((i) => edges[i].kind === "plays")).length;
    const follows = outgoing("follows").filter((edge) => nodeOf(edge.to).kind === "promoter").length;
    summary = `${listens} ${listens === 1 ? "artist" : "artists"} you play ${listens === 1 ? "is" : "are"} on upcoming bills, and you follow ${follows} ${follows === 1 ? "promoter" : "promoters"}.`;
  } else if (node.kind === "artist") {
    nights = outgoing("plays").map((edge) => nodeOf(edge.to));
    const lead = node.relation === "direct" ? "In your rotation." : node.via === "similar" ? "Similar to artists you play; no listening of your own yet." : node.via === "tag" ? "From a tag cluster you play; no listening of your own yet." : node.via === "promoter" ? "Found through a promoter you follow; no listening of your own yet." : node.relation === "adjacent" ? "Adjacent to your profile; no listening of your own yet." : "New to you.";
    const known = (index.anchoredBill[node.id] ?? []).map((i) => edges[i]).map((edge) => ({ other: nodeOf(edge.from === node.id ? edge.to : edge.from), weight: edge.weight })).filter((tie) => tie.other.relation === "direct").sort((a, b) => b.weight - a.weight || cmp(a.other.label, b.other.label))[0];
    const roster = incoming("rosters").map((edge) => nodeOf(edge.from).label).sort()[0];
    summary = `${lead} On ${count(nights.length, "bill")}.${known && node.relation !== "direct" ? ` Shares a bill with ${known.other.label}, whom you play.` : ""}${roster ? ` On the ${roster} roster.` : ""}${rated("their nights")}`;
  } else if (node.kind === "event") {
    nights = [node];
    const venue = outgoing("at").map((edge) => nodeOf(edge.to).label)[0];
    const promoters = incoming("presents").map((edge) => nodeOf(edge.from).label).sort();
    const bill = incoming("plays").map((edge) => nodeOf(edge.from));
    const direct = bill.filter((artist) => artist.relation === "direct").length;
    summary = `${venue ? `At ${venue}` : "Venue not listed"}${promoters.length ? `, presented by ${promoters.join(" and ")}` : ""}. ${bill.length} ${bill.length === 1 ? "artist" : "artists"} on the bill${direct ? `, ${direct} in your rotation` : ""}.${node.destination ? " On your destination watchlist." : ""}`;
  } else if (node.kind === "game") {
    nights = [node];
    const venue = outgoing("at").map((edge) => nodeOf(edge.to).label)[0];
    summary = `${node.label}${venue ? `, at ${venue}` : ""}.`;
  } else if (node.kind === "venue") {
    nights = incoming("at").map((edge) => nodeOf(edge.from));
    summary = `${capitalize(count(nights.length, "date"))}${node.city ? ` in ${node.city}` : ""}.${rated("nights here")}`;
  } else if (node.kind === "promoter") {
    nights = outgoing("presents").map((edge) => nodeOf(edge.to));
    const roster = outgoing("rosters").length;
    summary = `${node.followed ? "A promoter you follow. " : ""}Presents ${count(nights.length, "night")}.${roster ? ` ${roster} roster ${roster === 1 ? "artist is" : "artists are"} on upcoming bills.` : ""}${rated("their nights")}`;
  } else if (node.kind === "team") {
    nights = outgoing("hosts").map((edge) => nodeOf(edge.to));
    summary = `${anchor ? "A home team you follow. " : ""}${capitalize(count(nights.length, "home game"))}.`;
  } else if (node.kind === "opponent") {
    nights = outgoing("visits").map((edge) => nodeOf(edge.to));
    summary = `Visiting for ${count(nights.length, "game")}.${rated("games against them")}`;
  } else if (node.kind === "shape") {
    nights = incoming("is-a").map((edge) => nodeOf(edge.from));
    summary = `${capitalize(count(nights.length, "date"))} of this kind.${rated(node.label)}`;
  }
  return {
    label: node.label,
    kind: node.kind,
    summary,
    events: nights.sort((a, b) => cmp(a.startLocal, b.startLocal) || cmp(a.id, b.id)).map((night) => ({ id: night.eventId, title: night.label, startLocal: night.startLocal }))
  };
}
function buildIndex(nodes, edges) {
  const index = { byId: {}, out: {}, in: {}, bill: {}, anchoredBill: {}, anchor: {} };
  nodes.forEach((node, position) => {
    index.byId[node.id] = position;
  });
  const push = (table, id, value) => (table[id] ?? (table[id] = [])).push(value);
  edges.forEach((edge, i) => {
    push(index.out, edge.from, i);
    push(index.in, edge.to, i);
    if (edge.from === "you" && edge.kind !== "watching") {
      const current = index.anchor[edge.to];
      if (current === void 0 || edge.weight > edges[current].weight) index.anchor[edge.to] = i;
    }
  });
  edges.forEach((edge, i) => {
    if (edge.kind !== "shares-bill") return;
    push(index.bill, edge.from, i);
    push(index.bill, edge.to, i);
    if (index.anchor[edge.to] !== void 0) push(index.anchoredBill, edge.from, i);
    if (index.anchor[edge.from] !== void 0) push(index.anchoredBill, edge.to, i);
  });
  return index;
}
function resolveEvent(graph, eventId) {
  const byId = graph?.index?.byId;
  if (!byId || eventId == null) return null;
  for (const id of [`event:${eventId}`, `game:${eventId}`, String(eventId)]) {
    const node = byId[id] === void 0 ? null : graph.nodes[byId[id]];
    if (node && (node.kind === "event" || node.kind === "game")) return node;
  }
  return null;
}
function describePath(hops, target) {
  const kinds = hops.slice(1).map((hop) => hop.via);
  const first = kinds[0];
  const last = kinds[kinds.length - 1];
  const anchor = hops[1];
  const kind = kinds.includes("shares-bill") ? "shared-bill" : kinds.includes("rosters") ? "roster" : kinds.includes("books") ? "booking" : first === "watching" ? "watchlist" : first === "listens" ? "artist" : first === "near" ? "near-artist" : first === "learned" ? "learned" : last === "hosts" ? "home-team" : "promoter";
  if (first === "watching") return { kind, text: `${target.destination ?? target.label} is on your destination watchlist.` };
  if (last === "plays") {
    const billed = hops[hops.length - 2].label;
    if (hops.length === 3) {
      return {
        kind,
        text: first === "listens" ? `You play ${billed}, who is on the bill.` : first === "near" ? `${billed} is on the bill and sits close to what you play.` : `You have rated nights with ${billed} well, and ${billed} is on the bill.`
      };
    }
    let text2 = billed;
    for (let position = hops.length - 2; position >= 2; position -= 1) {
      const opening = position === hops.length - 2;
      const toward = hops[position - 1].label;
      text2 += hops[position].via === "rosters" ? `${opening ? " is" : ", who is"} on the roster of ${toward}` : hops[position].via === "books" ? `${opening ? " plays another" : ", who plays an"} upcoming night for ${toward}` : opening ? ` shares another upcoming bill with ${toward}` : `, who shares one with ${toward}`;
    }
    const tail = anchor.nodeKind === "promoter" ? first === "follows" ? ", which you follow." : ", whose nights you have rated well." : first === "listens" ? ", whom you play." : first === "near" ? ", who sits close to what you play." : ", whom you have rated well.";
    return { kind, text: `${text2}${tail}` };
  }
  const game = target.kind === "game";
  const text = last === "presents" ? first === "follows" ? `You follow ${anchor.label}, which presents this night.` : `You have rated ${anchor.label} nights well.` : last === "at" ? `You have rated ${game ? "games" : "nights"} at ${anchor.label} well.` : last === "is-a" ? `You have rated ${anchor.label} well.` : last === "hosts" ? `You follow the ${anchor.label}, and this is a home game.` : last === "visits" ? `You have rated games against the ${anchor.label} well.` : `${anchor.label} connects you to this ${game ? "game" : "night"}.`;
  return { kind, text };
}
function circularMean(pairs) {
  let x = 0;
  let y = 0;
  for (const [angle, weight] of pairs) {
    if (!Number.isFinite(angle) || !(weight > 0)) continue;
    x += Math.cos(angle) * weight;
    y += Math.sin(angle) * weight;
  }
  if (Math.hypot(x, y) < 1e-9) return null;
  return (Math.atan2(y, x) + TWO_PI) % TWO_PI;
}
function spread(items, minGap) {
  const n = items.length;
  if (!n) return /* @__PURE__ */ new Map();
  const gap = Math.min(minGap, TWO_PI / n);
  const sorted = [...items].sort((a, b) => a.angle - b.angle || cmp(a.id, b.id));
  const fanned = [];
  for (let start = 0; start < n; ) {
    let end = start;
    while (end + 1 < n && sorted[end + 1].angle - sorted[start].angle < 1e-9) end += 1;
    const size = end - start + 1;
    for (let k = 0; k < size; k += 1) fanned.push({ id: sorted[start + k].id, angle: sorted[start].angle + (k - (size - 1) / 2) * gap });
    start = end + 1;
  }
  fanned.sort((a, b) => a.angle - b.angle || cmp(a.id, b.id));
  let cut = 0;
  let widest = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const next = i === n - 1 ? fanned[0].angle + TWO_PI : fanned[i + 1].angle;
    if (next - fanned[i].angle > widest + 1e-12) {
      widest = next - fanned[i].angle;
      cut = (i + 1) % n;
    }
  }
  const ring = [...fanned.slice(cut), ...fanned.slice(0, cut).map((item) => ({ ...item, angle: item.angle + TWO_PI }))];
  const positions = ring.map((item) => item.angle);
  for (let i = 1; i < n; i += 1) positions[i] = Math.max(positions[i], positions[i - 1] + gap);
  const limit = positions[0] + TWO_PI - gap;
  if (positions[n - 1] > limit) {
    positions[n - 1] = limit;
    for (let i = n - 2; i >= 1; i -= 1) positions[i] = Math.min(positions[i], positions[i + 1] - gap);
  }
  return new Map(ring.map((item, i) => [item.id, (positions[i] % TWO_PI + TWO_PI) % TWO_PI]));
}
function liveRows(rows, today) {
  const seen = /* @__PURE__ */ new Set();
  return list(rows).filter((row) => row && typeof row === "object" && row.id != null && row.id !== "" && !row.ranking?.excluded).filter((row) => !today || !/^\d{4}-\d{2}-\d{2}/.test(String(row.startLocal ?? "")) || String(row.startLocal).slice(0, 10) >= today).sort((a, b) => cmp(String(a.id), String(b.id)) || cmp(String(a.startLocal ?? ""), String(b.startLocal ?? "")) || cmp(String(a.title ?? ""), String(b.title ?? ""))).filter((row) => !seen.has(String(row.id)) && seen.add(String(row.id)));
}
function localDateKey2(now) {
  if (now == null || now === "") return null;
  if (typeof now === "string" && /^\d{4}-\d{2}-\d{2}/.test(now)) return now.slice(0, 10);
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function frozenKey(row, category) {
  const key = row.feedbackKeys?.[category]?.[0]?.key;
  return typeof key === "string" && key.startsWith(`${category}:`) && key.length > category.length + 1 ? key : null;
}
function frozenLabel(row, category) {
  return frozenKey(row, category) ? clean(row.feedbackKeys[category][0].label) || null : null;
}
function entriesOf(table) {
  if (!table) return [];
  const entries = table instanceof Map ? [...table.entries()] : typeof table === "object" ? Object.entries(table) : [];
  return entries.sort((a, b) => cmp(String(a[0]), String(b[0])));
}
function byScore(a, b) {
  return b.score - a.score || cmp(a.startLocal, b.startLocal) || cmp(a.id, b.id);
}
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function list(value) {
  return Array.isArray(value) ? value : [];
}
function clean(value) {
  return String(value ?? "").trim().slice(0, 160);
}
function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function round3(value, places = 4) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
export {
  DEFAULT_PLAN_CONSTRAINTS,
  FEEDBACK_POLICY,
  GRAPH_POLICY,
  PLAN_POLICY,
  applyFeedbackOverlay,
  buildDecisionPlans,
  buildEvidenceGraph,
  buildFeedbackReview,
  buildOverviewBuckets,
  connectionPaths,
  constellation,
  deriveFeedbackSignals,
  describeLearning,
  describeNode,
  feedbackKeysFor,
  findScenes,
  normalizePlanConstraints,
  planCandidates
};
