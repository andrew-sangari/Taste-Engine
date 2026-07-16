import { UrgencyChip } from 'taste-engine-site';

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

export function Watch() {
  return (
    <div style={canvas}>
      <UrgencyChip urgency="watch" />
    </div>
  );
}

export function SafeToWait() {
  return (
    <div style={canvas}>
      <UrgencyChip urgency="safe to wait" />
    </div>
  );
}
