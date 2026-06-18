import type {
  Anomaly,
  AnomalyType,
  ReviewDecision,
  ReviewLabel,
  StatisticsSummary,
} from "@/types";

export function computeStatistics(
  anomalies: Anomaly[],
  decisions: ReviewDecision[]
): StatisticsSummary {
  const decisionMap = new Map(decisions.map((d) => [d.anomalyId, d]));

  const byType: Record<AnomalyType, number> = {
    missing: 0,
    out_of_range: 0,
    jump: 0,
    duplicate_timestamp: 0,
  };

  const byLabel: Record<ReviewLabel | "unreviewed", number> = {
    confirmed_fault: 0,
    false_positive: 0,
    ignored: 0,
    unreviewed: 0,
  };

  const bySensor: Record<string, number> = {};

  for (const a of anomalies) {
    byType[a.type]++;

    if (!bySensor[a.sensorName]) bySensor[a.sensorName] = 0;
    bySensor[a.sensorName]++;

    const decision = decisionMap.get(a.id);
    if (decision) {
      byLabel[decision.label]++;
    } else {
      byLabel.unreviewed++;
    }
  }

  const total = anomalies.length;
  const reviewed = total - byLabel.unreviewed;

  return {
    totalAnomalies: total,
    byType,
    byLabel,
    bySensor,
    confirmedFaultRate:
      total > 0 ? (byLabel.confirmed_fault / total) * 100 : 0,
    falsePositiveRate:
      total > 0 ? (byLabel.false_positive / total) * 100 : 0,
    completionRate: total > 0 ? (reviewed / total) * 100 : 0,
  };
}

export function formatNumber(value: number, fractionDigits = 1): string {
  if (!isFinite(value)) return "0";
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function generateId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
