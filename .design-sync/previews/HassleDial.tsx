import { HassleDial } from 'taste-engine-site';

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

export function LowHassle() {
  return (
    <div style={canvas}>
      <HassleDial score={2} />
    </div>
  );
}

export function ElevatedHassle() {
  return (
    <div style={canvas}>
      <HassleDial score={6} />
    </div>
  );
}

export function HighHassle() {
  return (
    <div style={canvas}>
      <HassleDial score={9} />
    </div>
  );
}
