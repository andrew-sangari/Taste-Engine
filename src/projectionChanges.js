import { URGENCY_PRIORITY } from './ranking.js';

export const DEFAULT_CHANGES_TOP_N = 5;

// Decision-relevant changes between the accepted public projection and the
// next one. Raw candidate churn below the surfaced top-N is deliberately not
// reported: an event leaving the ranked inventory is not a cancellation and
// must never read like one. Display precedence gives each event exactly one
// mention: overview change → plan-ahead change → urgency upgrade → newly
// shortlisted.
export function buildChangesSinceRefresh(accepted, next, { topN = DEFAULT_CHANGES_TOP_N } = {}) {
  if (!isProjectionShape(accepted) || !isProjectionShape(next)) return null;
  const mentioned = new Set();

  const beforeOverview = idList(accepted.overview);
  const afterOverview = idList(next.overview);
  const overview = membership(beforeOverview, afterOverview, mentioned);
  overview.reordered = survivorOrderChanged(beforeOverview, afterOverview);

  const planAhead = membership(idList(accepted.overviewPlanAhead), idList(next.overviewPlanAhead), mentioned);
  delete planAhead.reordered;

  const beforeItems = collectItems(accepted, topN);
  const afterItems = collectItems(next, topN);

  const urgencyUpgrades = [];
  for (const [key, after] of afterItems.all) {
    if (mentioned.has(key)) continue;
    const before = beforeItems.all.get(key);
    if (!before) continue;
    if (!after.visible && !before.visible) continue;
    const beforePriority = URGENCY_PRIORITY[before.urgency];
    const afterPriority = URGENCY_PRIORITY[after.urgency];
    if (beforePriority == null || afterPriority == null || afterPriority <= beforePriority) continue;
    urgencyUpgrades.push({ vertical: after.vertical, id: after.id, title: after.title, before: before.urgency, after: after.urgency });
    mentioned.add(key);
  }

  const newlyShortlisted = [];
  for (const [key, item] of afterItems.topN) {
    if (mentioned.has(key) || beforeItems.topN.has(key)) continue;
    newlyShortlisted.push({ vertical: item.vertical, id: item.id, title: item.title });
    mentioned.add(key);
  }

  const meaningful = overview.added.length || overview.removed.length || overview.reordered
    || planAhead.added.length || planAhead.removed.length
    || urgencyUpgrades.length || newlyShortlisted.length;
  if (!meaningful) return null;

  return {
    previousGeneratedAt: typeof accepted.generatedAt === 'string' ? accepted.generatedAt : null,
    overview,
    planAhead,
    urgencyUpgrades: urgencyUpgrades.sort(byVerticalThenId),
    newlyShortlisted: newlyShortlisted.sort(byVerticalThenId)
  };
}

function isProjectionShape(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.overview) && Array.isArray(value.events));
}

function idList(items) {
  return (items ?? [])
    .filter((item) => item?.id != null)
    .map((item) => ({ key: String(item.id), id: String(item.id), vertical: item.vertical ?? 'music', title: String(item.title ?? '') }));
}

function membership(before, after, mentioned) {
  const beforeKeys = new Set(before.map((item) => item.key));
  const afterKeys = new Set(after.map((item) => item.key));
  const added = after.filter((item) => !beforeKeys.has(item.key)).map(changedItem);
  const removed = before.filter((item) => !afterKeys.has(item.key)).map(changedItem);
  for (const item of [...added, ...removed]) mentioned.add(item.id);
  return { added, removed, reordered: false };
}

function changedItem({ vertical, id, title }) {
  return { vertical, id, title };
}

// Only a change in the relative order of items present in BOTH lists counts
// as a reorder; removals of other items alone must not set this flag.
function survivorOrderChanged(before, after) {
  const afterKeys = new Set(after.map((item) => item.key));
  const beforeSurvivors = before.filter((item) => afterKeys.has(item.key)).map((item) => item.key);
  const beforeKeys = new Set(before.map((item) => item.key));
  const afterSurvivors = after.filter((item) => beforeKeys.has(item.key)).map((item) => item.key);
  return beforeSurvivors.join('|') !== afterSurvivors.join('|');
}

function collectItems(projection, topN) {
  const all = new Map();
  const top = new Map();
  const surfacedIds = new Set([...idList(projection.overview), ...idList(projection.overviewPlanAhead)].map((item) => item.key));
  const add = (item, vertical, index) => {
    if (item?.id == null) return;
    const key = String(item.id);
    const entry = {
      id: key,
      vertical,
      title: titleFor(item, vertical),
      urgency: item.ranking?.urgency ?? item.urgency ?? null,
      visible: index < topN || surfacedIds.has(key)
    };
    all.set(key, entry);
    if (index < topN) top.set(key, entry);
  };
  (projection.events ?? []).forEach((item, index) => add(item, 'music', index));
  (projection.sports ?? []).forEach((item, index) => add(item, 'sports', index));
  return { all, topN: top };
}

function titleFor(item, vertical) {
  if (item.title) return String(item.title);
  if (vertical === 'sports' && item.awayTeam) {
    return `Dodgers vs. ${item.awayTeam.shortName ?? item.awayTeam.name ?? 'opponent'}`;
  }
  return String(item.id ?? '');
}

function byVerticalThenId(left, right) {
  return `${left.vertical}|${left.id}`.localeCompare(`${right.vertical}|${right.id}`);
}
