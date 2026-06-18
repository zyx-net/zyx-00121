export type AnomalyType =
  | "missing"
  | "out_of_range"
  | "jump"
  | "duplicate_timestamp";

export type ReviewLabel = "confirmed_fault" | "false_positive" | "ignored";

export type BatchStatus =
  | "importing"
  | "detecting"
  | "reviewing"
  | "completed"
  | "rolled_back";

export interface Device {
  id: string;
  name: string;
  code: string;
}

export interface SensorRule {
  id: string;
  deviceId: string;
  sensorName: string;
  minValue: number;
  maxValue: number;
  jumpThreshold: number;
  unit: string;
}

export interface MissingRule {
  id: string;
  sensorName: string;
  maxGapSeconds: number;
  maxConsecutiveMissing: number;
}

export interface RuleVersion {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  description: string;
  devices: Device[];
  sensorRules: SensorRule[];
  missingRules: MissingRule[];
}

export interface DataPoint {
  id: string;
  timestamp: string;
  sensorName: string;
  value: number;
}

export interface Anomaly {
  id: string;
  type: AnomalyType;
  sensorName: string;
  timestamp: string;
  value: number | null;
  expectedValue?: number;
  previousValue?: number;
  nextValue?: number;
  description: string;
}

export interface ReviewDecision {
  id: string;
  anomalyId: string;
  label: ReviewLabel;
  reviewedAt: string;
  comment?: string;
  previousLabel?: ReviewLabel;
  isSuperseded?: boolean;
  sequence?: number;
}

export interface RollbackLog {
  id: string;
  fromRuleVersionId: string;
  toRuleVersionId: string;
  rolledBackAt: string;
  reason: string;
}

export interface Batch {
  id: string;
  batchNo: string;
  ruleVersionId: string;
  importedAt: string;
  note: string;
  totalRows: number;
  status: BatchStatus;
  dataPoints: DataPoint[];
  anomalies: Anomaly[];
  decisions: ReviewDecision[];
  rollbackLogs: RollbackLog[];
}

export interface ImportValidationResult {
  valid: boolean;
  errors: ImportError[];
  warnings: string[];
  dataPoints: DataPoint[];
  rowCount: number;
}

export interface ImportError {
  row: number;
  column: string;
  message: string;
  type: "bad_timestamp" | "unknown_sensor" | "invalid_value" | "duplicate";
}

export interface StatisticsSummary {
  totalAnomalies: number;
  byType: Record<AnomalyType, number>;
  byLabel: Record<ReviewLabel | "unreviewed", number>;
  bySensor: Record<string, number>;
  confirmedFaultRate: number;
  falsePositiveRate: number;
  completionRate: number;
}

export const REVIEW_LABEL_META: Record<
  ReviewLabel,
  { name: string; color: string; bgClass: string; textClass: string }
> = {
  confirmed_fault: {
    name: "确认故障",
    color: "#ef4444",
    bgClass: "bg-red-100",
    textClass: "text-red-700",
  },
  false_positive: {
    name: "误报",
    color: "#10b981",
    bgClass: "bg-green-100",
    textClass: "text-green-700",
  },
  ignored: {
    name: "忽略",
    color: "#64748b",
    bgClass: "bg-slate-100",
    textClass: "text-slate-700",
  },
};

export const ANOMALY_TYPE_META: Record<
  AnomalyType,
  { name: string; color: string; bgClass: string; textClass: string; icon: string }
> = {
  missing: {
    name: "数据缺失",
    color: "#f97316",
    bgClass: "bg-orange-100",
    textClass: "text-orange-700",
    icon: "AlertTriangle",
  },
  out_of_range: {
    name: "越界异常",
    color: "#ef4444",
    bgClass: "bg-red-100",
    textClass: "text-red-700",
    icon: "AlertOctagon",
  },
  jump: {
    name: "跳变异常",
    color: "#8b5cf6",
    bgClass: "bg-purple-100",
    textClass: "text-purple-700",
    icon: "TrendingUp",
  },
  duplicate_timestamp: {
    name: "重复时间戳",
    color: "#eab308",
    bgClass: "bg-yellow-100",
    textClass: "text-yellow-700",
    icon: "Copy",
  },
};
