import type { ReactNode } from "react";

export type SemanticEvidenceStatus = "verified" | "inferred" | "not known";

export type SemanticEvidenceRef = {
  source: string;
  url?: string | null;
  retrievedAt?: string | null;
  status: SemanticEvidenceStatus;
};

export type SemanticInsightClaim = {
  text: string;
  status: SemanticEvidenceStatus;
  // Where the claim comes from: a source's published fact, Jev's
  // characterization of published facts, a match against the taste profile, or
  // a consequential gap/disagreement. Diagnostic; the status is what renders.
  basis?: "documented-attribute" | "model-characterization" | "calculated-match" | "uncertainty" | "conflict";
  eventBasis?: "documented-attribute" | "model-characterization";
  evidence?: SemanticEvidenceRef[];
};

type ClaimKind = "whatToExpect" | "whyItMayFit" | "worthPlanning" | "worthChecking";

/**
 * A display-safe, deterministic summary of an advisory event assessment.
 *
 * This is intentionally separate from the canonical ranking contract. The
 * server may omit the object when the supplied evidence has nothing useful to
 * add; the card then remains exactly the existing deterministic card.
 */
export type SemanticEventInsight = {
  summary?: string | null;
  whatToExpect?: SemanticInsightClaim | null;
  whyItMayFit?: SemanticInsightClaim | null;
  worthPlanning?: SemanticInsightClaim | null;
  worthChecking?: SemanticInsightClaim | null;
  // The composer's order, most consequential first. Older snapshots omit it.
  claimOrder?: ClaimKind[];
  evidence?: SemanticEvidenceRef[];
};

type ClaimEntry = { kind: ClaimKind; label: string; claim: SemanticInsightClaim };

const CLAIM_LABELS: Array<[ClaimKind, string]> = [
  ["whatToExpect", "What to expect"],
  ["whyItMayFit", "Why it may fit"],
  ["worthPlanning", "Worth planning around"],
  ["worthChecking", "Worth checking"],
];

export function hasSemanticInsight(insight: SemanticEventInsight | null | undefined) {
  if (!insight) return false;
  if (cleanText(insight.summary)) return true;
  // An isolated "not known" claim is a gap report, not enrichment. Keep the
  // deterministic card unchanged until there is at least one useful signal.
  return claimEntries(insight).some(({ claim }) => safeStatus(claim.status) !== "not known");
}

/**
 * Render one compact card hint or the progressively disclosed event detail.
 * No raw probabilities, provider state, or blanket unknown list belongs here.
 */
export function SemanticEventInsightView({ insight, compact = false }: { insight: SemanticEventInsight | null | undefined; compact?: boolean }) {
  if (!hasSemanticInsight(insight)) return null;
  const safeInsight = insight!;
  const claims = selectedClaims(safeInsight);
  const summary = cleanText(safeInsight.summary) ?? claims[0]?.claim.text ?? null;
  if (!summary) return null;
  if (compact) {
    return <p className="semanticInsightCompact"><span className="semanticInsightChip">{summary}</span></p>;
  }

  const evidence = evidenceEntries(safeInsight, claims);
  return <div className="semanticInsight">
    <p className="semanticInsightCompact"><span className="semanticInsightChip">{summary}</span></p>
    <details className="semanticInsightDetails">
      <summary>About this night</summary>
      <section aria-label="About this night">
        {summary !== claims[0]?.claim.text ? <p className="semanticInsightSummary">{summary}</p> : null}
        {claims.length ? <div className="semanticInsightClaims">
          {claims.map(({ label, claim }) => <Claim key={label} label={label} claim={claim} />)}
        </div> : null}
        {evidence.length ? <details className="semanticEvidence">
          <summary>How do we know?</summary>
          <ul>
            {evidence.map((entry, index) => <li key={`${entry.label}-${entry.ref.source}-${entry.ref.url ?? index}`}>
              <strong>{entry.label}</strong>
              <span>{evidenceSource(entry.ref)}</span>
            </li>)}
          </ul>
        </details> : null}
      </section>
    </details>
  </div>;
}

function Claim({ label, claim }: { label: string; claim: SemanticInsightClaim }) {
  const text = cleanText(claim.text);
  if (!text) return null;
  const status = safeStatus(claim.status);
  return <p className={`semanticInsightClaim claim-${statusClass(status)}`}>
    <strong>{label}</strong>
    <span>{text}</span>
    <em>{status}</em>
  </p>;
}

function claimEntries(insight: SemanticEventInsight): ClaimEntry[] {
  return CLAIM_LABELS.flatMap(([kind, label]) => {
    const value = insight[kind];
    if (!value || typeof value !== "object") return [];
    const text = cleanText(value.text);
    if (!text) return [];
    return [{ kind, label, claim: { ...value, text } }];
  });
}

function selectedClaims(insight: SemanticEventInsight): ClaimEntry[] {
  const claims = claimEntries(insight);
  const order = Array.isArray(insight.claimOrder) ? insight.claimOrder : [];
  if (order.length) {
    // The server ranked these by consequence; keep its order and its bound.
    const rank = (kind: ClaimKind) => {
      const index = order.indexOf(kind);
      return index === -1 ? order.length : index;
    };
    return [...claims].sort((left, right) => rank(left.kind) - rank(right.kind)).slice(0, 3);
  }
  const useful = claims.filter(({ claim }) => safeStatus(claim.status) !== "not known");
  const gaps = claims.filter(({ claim }) => safeStatus(claim.status) === "not known");
  // Keep the expanded card bounded. Positive characterization wins first;
  // only use a concrete gap when fewer than three useful points exist.
  return [...useful, ...gaps].slice(0, 3);
}

function evidenceEntries(insight: SemanticEventInsight, claims: ClaimEntry[]) {
  const output: Array<{ label: string; ref: SemanticEvidenceRef }> = [];
  const add = (label: string, ref: SemanticEvidenceRef | null | undefined) => {
    if (!ref || !cleanText(ref.source)) return;
    const key = `${label}|${ref.source}|${ref.url ?? ""}|${ref.retrievedAt ?? ""}|${ref.status}`;
    if (output.some((entry) => `${entry.label}|${entry.ref.source}|${entry.ref.url ?? ""}|${entry.ref.retrievedAt ?? ""}|${entry.ref.status}` === key)) return;
    output.push({ label, ref });
  };
  for (const { label, claim } of claims) for (const ref of claim.evidence ?? []) add(label, ref);
  for (const ref of insight.evidence ?? []) add("Event evidence", ref);
  return output;
}

function evidenceSource(ref: SemanticEvidenceRef): ReactNode {
  const source = cleanText(ref.source) ?? "Source";
  const url = safeEvidenceUrl(ref.url);
  const sourceNode = url
    ? <a href={url} rel="noreferrer" target="_blank">{source} ↗</a>
    : source;
  const retrieved = ref.retrievedAt ? ` · retrieved ${formatRetrievedAt(ref.retrievedAt)}` : "";
  return <>{sourceNode} · {safeStatus(ref.status)}{retrieved}</>;
}

function formatRetrievedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
}

function statusClass(value: SemanticEvidenceStatus) {
  return value === "not known" ? "unknown" : value;
}

function safeStatus(value: unknown): SemanticEvidenceStatus {
  return value === "verified" || value === "inferred" ? value : "not known";
}

function safeEvidenceUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}
