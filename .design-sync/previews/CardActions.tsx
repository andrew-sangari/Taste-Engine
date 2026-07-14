import { CardActions } from 'taste-engine-site';

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
  maxWidth: 320,
};

export function MusicEvent() {
  return (
    <div style={canvas}>
      <CardActions
        layout="music"
        planning={{
          planningSnapshot: { itemId: 'qa-music-image', title: 'Short Signal', dateLocal: '2026-07-15', vertical: 'music', locationLabel: 'The Example Hall · Los Angeles' },
          feedbackSnapshot: { feedbackSnapshotId: 'fs-qa-music-image', canonicalEventId: 'qa-music-image', eventDateLocal: '2026-07-15', eventTitleSnapshot: 'Short Signal', vertical: 'music' },
        }}
        calendarEvent={{
          uid: 'qa-music-image',
          title: 'Short Signal',
          startLocal: '2026-07-15T20:00:00-07:00',
          dateLocal: '2026-07-15',
          allDay: false,
          locationLabel: 'The Example Hall · Los Angeles',
          description: 'A direct synthetic seed with a compact venue and a clean weeknight fit.',
          url: 'https://example.com/synthetic/short-signal',
        }}
      />
    </div>
  );
}

export function MovieNoFeedback() {
  return (
    <div style={canvas}>
      <CardActions
        layout="movie"
        planning={{
          planningSnapshot: { itemId: 'qa-movie-confirmed', title: 'Synthetic Projection', dateLocal: '2026-07-20', vertical: 'movies', locationLabel: 'Synthetic Cinema · Los Angeles' },
          feedbackSnapshot: null,
        }}
        calendarEvent={{
          uid: 'qa-movie-confirmed',
          title: 'Synthetic Projection',
          startLocal: null,
          dateLocal: '2026-07-20',
          allDay: true,
          locationLabel: 'Synthetic Cinema · Los Angeles',
          description: 'The local fixture confirms a premium presentation.',
          url: 'https://example.com/synthetic/synthetic-projection',
        }}
      />
    </div>
  );
}
