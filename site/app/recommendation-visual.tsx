import type { CSSProperties } from "react";

export type RecommendationVisual = {
  kind: "image" | "texture" | "none";
  url?: string;
  alt?: string;
  focalPoint?: { x: number; y: number };
  variant?: string;
  attribution?: string;
};

export function RecommendationVisual({ visual, className = "" }: { visual?: RecommendationVisual | null; className?: string }) {
  const value = visual ?? { kind: "none" as const };
  const focalPoint = normalizeFocalPoint(value.focalPoint);
  const style: CSSProperties = {
    backgroundPosition: `${focalPoint.x}% ${focalPoint.y}%`
  };
  if (value.kind === "image" && value.url) {
    style.backgroundImage = `url("${String(value.url).replaceAll('"', '%22')}")`;
  }
  return <div
    aria-hidden={value.kind !== "image" || !value.alt ? true : undefined}
    aria-label={value.kind === "image" ? value.alt : undefined}
    className={`recommendationVisual ${className}`.trim()}
    data-attribution={value.attribution ?? undefined}
    data-kind={value.kind}
    data-variant={value.variant ?? "none"}
    role={value.kind === "image" && value.alt ? "img" : undefined}
    style={style}
  />;
}

function normalizeFocalPoint(value?: { x: number; y: number } | null) {
  return {
    x: clamp(value?.x),
    y: clamp(value?.y)
  };
}

function clamp(value: number | undefined) {
  if (value == null || value === ("" as unknown as number)) return 50;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 50;
}
