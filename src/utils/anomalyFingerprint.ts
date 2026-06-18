import type { Anomaly, ReviewDecision } from "@/types";

export function generateAnomalyFingerprint(anomaly: Pick<
  Anomaly,
  "type" | "sensorName" | "timestamp" | "value" | "previousValue" | "nextValue"
>): string {
  const parts = [
    anomaly.type,
    anomaly.sensorName,
    anomaly.timestamp,
    anomaly.value === null ? "null" : String(anomaly.value),
  ];
  if (anomaly.previousValue !== undefined) {
    parts.push(`pv:${anomaly.previousValue}`);
  }
  if (anomaly.nextValue !== undefined) {
    parts.push(`nv:${anomaly.nextValue}`);
  }
  return "fp_" + simpleHash(parts.join("|"));
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildFingerprintToAnomalyMap(anomalies: Anomaly[]): Map<string, Anomaly> {
  const map = new Map<string, Anomaly>();
  for (const a of anomalies) {
    if (a.fingerprint) {
      map.set(a.fingerprint, a);
    } else {
      map.set(generateAnomalyFingerprint(a), a);
    }
  }
  return map;
}

export function remapDecisionsAfterReDetect(
  oldAnomalies: Anomaly[],
  newAnomalies: Anomaly[],
  decisions: ReviewDecision[]
): { decisions: ReviewDecision[]; remappedCount: number } {
  const newAnomalyIds = new Set(newAnomalies.map(a => a.id));

  const oldFpMap = new Map<string, string>();
  for (const a of oldAnomalies) {
    const fp = a.fingerprint ?? generateAnomalyFingerprint(a);
    oldFpMap.set(a.id, fp);
  }

  const newFpToId = new Map<string, string>();
  for (const a of newAnomalies) {
    const fp = a.fingerprint ?? generateAnomalyFingerprint(a);
    newFpToId.set(fp, a.id);
  }

  let remappedCount = 0;
  const remappedDecisions = decisions.map((d): ReviewDecision => {
    if (newAnomalyIds.has(d.anomalyId)) {
      return d;
    }

    const oldFp = d.anomalyFingerprint ?? oldFpMap.get(d.anomalyId);
    if (!oldFp) return d;
    const newId = newFpToId.get(oldFp);
    if (!newId) return d;
    if (newId !== d.anomalyId) {
      remappedCount++;
      return { ...d, anomalyId: newId, anomalyFingerprint: oldFp };
    }
    return d;
  });

  return { decisions: remappedDecisions, remappedCount };
}
