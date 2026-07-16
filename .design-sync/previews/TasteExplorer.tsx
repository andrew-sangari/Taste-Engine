import { TasteExplorer } from 'taste-engine-site';

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

const profile = {
  generatedAt: '2026-07-12T12:00:00.000-07:00',
  seedSummary: { playlistCount: 4, sourceArtistCount: 18, topArtistCount: 12, artistCount: 27 },
  topArtists: [
    { name: 'Short Signal', relativeSignal: 92, playlistDiversity: 3, seedTrackCount: 14, origin: 'source', evidenceLabels: ['Direct playlist evidence'] },
    { name: 'Long Signal', relativeSignal: 78, playlistDiversity: 2, seedTrackCount: 9, origin: 'similar', evidenceLabels: ['Similar-artist discovery'] },
    { name: 'Night Market', relativeSignal: 61, playlistDiversity: 1, seedTrackCount: 5, origin: 'promoter', evidenceLabels: ['Promoter calendars'] },
  ],
  topTags: ['synthwave', 'warehouse', 'festival'],
  expansionByOrigin: { source: 12, similar: 8, tag: 5, promoter: 2 },
  feedback: { statusCounts: { 'attended-worth-it': 3, 'attended-not-worth-it': 1, 'skipped-no-longer-interested': 2 }, attendedCount: 4 },
};

export function WithTasteProfile() {
  return (
    <div style={canvas}>
      <TasteExplorer profile={profile} />
    </div>
  );
}

export function ProfileNotYetGenerated() {
  return (
    <div style={canvas}>
      <TasteExplorer profile={null} />
    </div>
  );
}
