import { ChangesStrip } from 'taste-engine-site';

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
  maxWidth: 520,
};

export function NewAndUrgencyChanges() {
  return (
    <div style={canvas}>
      <ChangesStrip
        changes={{
          previousGeneratedAt: '2026-07-10T12:00:00.000-07:00',
          overview: {
            added: [{ vertical: 'music', id: 'qa-music-festival', title: 'Synthetic Night Market + more' }],
            removed: [{ vertical: 'sports', id: 'qa-sports-default', title: 'Mariners' }],
            reordered: true,
          },
          planAhead: { added: [{ vertical: 'sports', id: 'qa-sports-high-leverage', title: 'Yankees' }], removed: [] },
          urgencyUpgrades: [{ vertical: 'music', id: 'qa-music-image', title: 'Short Signal', before: 'watch', after: 'buy now' }],
          newlyShortlisted: [],
        }}
      />
    </div>
  );
}

export function ReorderedOnly() {
  return (
    <div style={canvas}>
      <ChangesStrip
        changes={{
          previousGeneratedAt: '2026-07-11T12:00:00.000-07:00',
          overview: { added: [], removed: [], reordered: true },
          planAhead: { added: [], removed: [] },
          urgencyUpgrades: [],
          newlyShortlisted: [],
        }}
      />
    </div>
  );
}
