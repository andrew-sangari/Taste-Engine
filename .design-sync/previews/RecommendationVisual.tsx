import { RecommendationVisual } from 'taste-engine-site';

// public/ assets (like /tmdb-logo.svg) aren't part of this standalone bundle,
// so the "image" variant uses an inline data URI to show a genuinely loaded image.
const DEMO_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2362dfc3'/%3E%3Cstop offset='1' stop-color='%23173f36'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)'/%3E%3C/svg%3E";

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
};

const box: React.CSSProperties = {
  width: 280,
  height: 180,
  backgroundColor: 'var(--surface, #080a09)',
  borderRadius: 12,
  overflow: 'hidden',
  position: 'relative',
};

export function Image() {
  return (
    <div style={canvas}>
      <div style={box}>
        <RecommendationVisual
          className="preview-fill"
          visual={{ kind: 'image', url: DEMO_IMAGE, alt: 'Short Signal atmosphere', focalPoint: { x: 72, y: 50 }, attribution: 'Synthetic local fixture' }}
        />
      </div>
      <style>{`.preview-fill{position:absolute;inset:0;background-size:cover}`}</style>
    </div>
  );
}

export function Texture() {
  return (
    <div style={canvas}>
      <div style={box}>
        <RecommendationVisual className="preview-fill" visual={{ kind: 'texture', variant: 'music-warehouse-beams', focalPoint: { x: 80, y: 40 } }} />
      </div>
      <style>{`.preview-fill{position:absolute;inset:0;background-size:cover}`}</style>
    </div>
  );
}

export function None() {
  return (
    <div style={canvas}>
      <div style={box}>
        <RecommendationVisual className="preview-fill" visual={{ kind: 'none' }} />
      </div>
      <style>{`.preview-fill{position:absolute;inset:0;background-size:cover}`}</style>
    </div>
  );
}
