export type ChangedItem = { vertical: string; id: string; title: string };

export type ChangesSinceRefresh = {
  previousGeneratedAt: string | null;
  overview: { added: ChangedItem[]; removed: ChangedItem[]; reordered: boolean };
  planAhead: { added: ChangedItem[]; removed: ChangedItem[] };
  urgencyUpgrades: Array<ChangedItem & { before: string; after: string }>;
  newlyShortlisted: ChangedItem[];
};

// One quiet line summarizing decision-relevant movement since the accepted
// projection; details on demand. Absent block → nothing renders.
export function ChangesStrip({ changes }: { changes: ChangesSinceRefresh | null | undefined }) {
  if (!changes) return null;
  const shortlistedIn = [...changes.overview.added, ...changes.newlyShortlisted];
  const parts = [
    countPhrase(shortlistedIn.length + changes.planAhead.added.length, "newly shortlisted"),
    countPhrase(changes.overview.removed.length + changes.planAhead.removed.length, "left the shortlist"),
    ...changes.urgencyUpgrades.slice(0, 2).map((item) => `${item.title} moved to ${capitalize(item.after)}`),
  ].filter(Boolean);
  if (!parts.length && !changes.overview.reordered) return null;
  const since = changes.previousGeneratedAt
    ? new Date(changes.previousGeneratedAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" })
    : "the previous refresh";
  return (
    <details className="changesStrip">
      <summary>Since {since}: {parts.length ? parts.join(" · ") : "shortlist order changed"}</summary>
      <div className="changesDetail">
        <ChangeList items={shortlistedIn} label="Newly shortlisted" />
        <ChangeList items={changes.planAhead.added} label="Added to Plan Ahead" />
        <ChangeList items={[...changes.overview.removed, ...changes.planAhead.removed]} label="Left the shortlist" />
        {changes.urgencyUpgrades.length ? (
          <div><strong>Urgency</strong><ul>{changes.urgencyUpgrades.map((item) => <li key={item.id}>{item.title}: {item.before} → {item.after}</li>)}</ul></div>
        ) : null}
      </div>
    </details>
  );
}

function ChangeList({ items, label }: { items: ChangedItem[]; label: string }) {
  if (!items.length) return null;
  return <div><strong>{label}</strong><ul>{items.map((item) => <li key={`${item.vertical}:${item.id}`}>{item.title}</li>)}</ul></div>;
}

function countPhrase(count: number, label: string) {
  return count ? `${count} ${label}` : "";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
