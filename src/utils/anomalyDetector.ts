import type {
  Anomaly,
  AnomalyType,
  DataPoint,
  RuleVersion,
  SensorRule,
  MissingRule,
} from "@/types";
import { generateAnomalyFingerprint } from "@/utils/anomalyFingerprint";

function uid(prefix = "an"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function groupBySensor(dataPoints: DataPoint[]): Map<string, DataPoint[]> {
  const map = new Map<string, DataPoint[]>();
  for (const dp of dataPoints) {
    if (!map.has(dp.sensorName)) map.set(dp.sensorName, []);
    map.get(dp.sensorName)!.push(dp);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
  return map;
}

function detectDuplicateTimestamp(dataPoints: DataPoint[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const seen = new Map<string, DataPoint[]>();

  for (const dp of dataPoints) {
    const key = `${dp.sensorName}__${dp.timestamp}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(dp);
  }

  for (const [, group] of seen) {
    if (group.length > 1) {
      const first = group[0];
      anomalies.push({
        id: uid(),
        type: "duplicate_timestamp",
        sensorName: first.sensorName,
        timestamp: first.timestamp,
        value: first.value,
        description: `检测到 ${group.length} 条相同时间戳记录（传感器 ${first.sensorName}）`,
      });
    }
  }
  return anomalies;
}

function detectOutOfRange(
  dataPoints: DataPoint[],
  rules: SensorRule[]
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const ruleMap = new Map(rules.map((r) => [r.sensorName, r]));

  for (const dp of dataPoints) {
    const rule = ruleMap.get(dp.sensorName);
    if (!rule) continue;

    if (dp.value < rule.minValue || dp.value > rule.maxValue) {
      anomalies.push({
        id: uid(),
        type: "out_of_range",
        sensorName: dp.sensorName,
        timestamp: dp.timestamp,
        value: dp.value,
        expectedValue: (rule.minValue + rule.maxValue) / 2,
        description: `数值 ${dp.value.toFixed(3)} ${rule.unit || ""} 超出允许范围 [${rule.minValue}, ${rule.maxValue}]`,
      });
    }
  }
  return anomalies;
}

function detectJump(
  grouped: Map<string, DataPoint[]>,
  rules: SensorRule[]
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const ruleMap = new Map(rules.map((r) => [r.sensorName, r]));

  for (const [sensorName, points] of grouped) {
    const rule = ruleMap.get(sensorName);
    if (!rule || rule.jumpThreshold <= 0) continue;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const diff = Math.abs(curr.value - prev.value);

      if (diff > rule.jumpThreshold) {
        anomalies.push({
          id: uid(),
          type: "jump",
          sensorName,
          timestamp: curr.timestamp,
          value: curr.value,
          previousValue: prev.value,
          description: `数值跳变 ${diff.toFixed(3)} ${rule.unit || ""}，前值 ${prev.value.toFixed(3)} → 当前值 ${curr.value.toFixed(3)}，阈值 ${rule.jumpThreshold}`,
        });
      }
    }
  }
  return anomalies;
}

function detectMissing(
  grouped: Map<string, DataPoint[]>,
  rules: MissingRule[]
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const ruleMap = new Map(rules.map((r) => [r.sensorName, r]));
  const defaultGap = 60;
  const defaultConsecutive = 1;

  for (const [sensorName, points] of grouped) {
    const rule = ruleMap.get(sensorName);
    const maxGap = rule?.maxGapSeconds ?? defaultGap;
    const maxConsecutive = rule?.maxConsecutiveMissing ?? defaultConsecutive;

    let consecutiveMiss = 0;
    for (let i = 1; i < points.length; i++) {
      const prevT = new Date(points[i - 1].timestamp).getTime();
      const currT = new Date(points[i].timestamp).getTime();
      const gap = (currT - prevT) / 1000;

      if (gap > maxGap) {
        const missingCount = Math.floor(gap / maxGap) - 1;
        consecutiveMiss += missingCount;

        if (consecutiveMiss >= maxConsecutive) {
          anomalies.push({
            id: uid(),
            type: "missing",
            sensorName,
            timestamp: points[i - 1].timestamp,
            value: null,
            nextValue: points[i].value,
            description: `数据缺失：间隔 ${gap.toFixed(0)} 秒，超过阈值 ${maxGap} 秒，估计缺失约 ${missingCount} 个数据点`,
          });
        }
      } else {
        consecutiveMiss = 0;
      }
    }
  }
  return anomalies;
}

export function detectAnomalies(
  dataPoints: DataPoint[],
  ruleVersion: RuleVersion
): Anomaly[] {
  if (!dataPoints.length) return [];

  const grouped = groupBySensor(dataPoints);

  const results: Record<AnomalyType, Anomaly[]> = {
    duplicate_timestamp: detectDuplicateTimestamp(dataPoints),
    out_of_range: detectOutOfRange(dataPoints, ruleVersion.sensorRules),
    jump: detectJump(grouped, ruleVersion.sensorRules),
    missing: detectMissing(grouped, ruleVersion.missingRules),
  };

  const all = [
    ...results.duplicate_timestamp,
    ...results.out_of_range,
    ...results.jump,
    ...results.missing,
  ];

  all.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return all.map((an, idx) => ({
    ...an,
    id: `an_${idx + 1}_${Math.random().toString(36).slice(2, 8)}`,
    fingerprint: generateAnomalyFingerprint(an),
  }));
}
