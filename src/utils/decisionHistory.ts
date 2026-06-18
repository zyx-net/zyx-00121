import type { ReviewDecision } from "@/types";

export function collapseDecisions(
  decisions: ReviewDecision[]
): ReviewDecision[] {
  const latest = new Map<string, ReviewDecision>();
  const sorted = [...decisions].sort((a, b) => {
    const seqA = a.sequence ?? (a.isSuperseded ? 0 : 1);
    const seqB = b.sequence ?? (b.isSuperseded ? 0 : 1);
    return seqB - seqA;
  });

  for (const d of sorted) {
    if (latest.has(d.anomalyId)) continue;
    if (d.isSuperseded) continue;
    latest.set(d.anomalyId, d);
  }

  return Array.from(latest.values());
}

export function getDecisionHistory(
  decisions: ReviewDecision[],
  anomalyId: string
): ReviewDecision[] {
  return decisions
    .filter(d => d.anomalyId === anomalyId)
    .sort((a, b) => {
      const seqA = a.sequence ?? new Date(a.reviewedAt).getTime();
      const seqB = b.sequence ?? new Date(b.reviewedAt).getTime();
      return seqA - seqB;
    });
}
