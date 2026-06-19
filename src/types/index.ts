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

export type TimeFormatPreset = "auto" | "unix_seconds" | "unix_milliseconds" | "custom";

export interface TimeParseConfig {
  preset: TimeFormatPreset;
  customFormat?: string;
  columnName?: string;
}

export interface TimeParseConflictLog {
  id: string;
  rowNumber: number;
  rawValue: string;
  autoDetectedFormat: string;
  userSelectedFormat: string;
  autoParsedTimestamp: string | null;
  userParsedTimestamp: string | null;
  finalTimestamp: string | null;
  finalFormatUsed: string;
  conflictReason: string;
  resolvedAt: string;
}

export interface DataPoint {
  id: string;
  timestamp: string;
  rawTimestamp: string;
  sensorName: string;
  value: number;
  timeParseNote?: string;
  status?: ReviewLabel | "unreviewed" | "ok" | "anomaly";
  anomalies?: string[];
  sourceId?: string;
  ruleVersionId?: string;
  batchId?: string;
}

export interface ImportParseMetadata {
  timeConfig: TimeParseConfig;
  conflicts: TimeParseConflictLog[];
  autoDetectedFormatCounts: Record<string, number>;
  parseErrors: Array<{ row: number; rawValue: string; message: string }>;
  importedAt: string;
  hasBOM?: boolean;
  sourceName?: string;
  sourceType?: DataSourceType;
}

export interface ImportValidationResult {
  valid: boolean;
  errors: ImportError[];
  warnings: string[];
  dataPoints: DataPoint[];
  rowCount: number;
  parseMetadata: ImportParseMetadata;
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
  fingerprint?: string;
}

export interface ReviewDecision {
  id: string;
  anomalyId: string;
  anomalyFingerprint?: string;
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
  parseMetadata?: ImportParseMetadata;
}

export type DataSourceType = "csv" | "json";

export interface FieldMappingInfo {
  detectedFields: string[];
  mappedFields: {
    timestamp: string | null;
    sensorName: string | null;
    value: string | null;
  };
  unmappedFields: string[];
  missingFields: string[];
  suggestions: Record<string, string[]>;
}

export interface TimeParsePreviewItem {
  rowNumber: number;
  rawValue: string;
  detectedFormat: string;
  parsedTimestamp: string | null;
  isConflict: boolean;
  conflictReason?: string;
  finalFormatUsed: string;
}

export interface AnomalySummaryPreview {
  totalAnomalies: number;
  byType: Record<string, number>;
  bySensor: Record<string, number>;
}

export interface KeyColumnPreviewRow {
  rowNumber: number;
  rawTimestamp: string;
  standardizedTimestamp: string;
  sensorName: string;
  value: number;
  timeFormatUsed: string;
  parseNote?: string;
}

export interface PrecheckResult {
  sourceType: DataSourceType;
  sourceName: string;
  fieldMapping: FieldMappingInfo;
  timeParsePreview: {
    config: TimeParseConfig;
    formatDistribution: Record<string, number>;
    conflicts: TimeParseConflictLog[];
    previewRows: TimeParsePreviewItem[];
    parseErrorCount: number;
  };
  anomalySummary: AnomalySummaryPreview;
  keyColumnsPreview: KeyColumnPreviewRow[];
  validationResult: ImportValidationResult;
}

export interface PerSourceTimeConfigEntry {
  sourceId: string;
  sourceName: string;
  config: TimeParseConfig;
  updatedAt: string;
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

export type ImportOperationStatus =
  | "pending"
  | "previewing"
  | "importing"
  | "completed"
  | "failed"
  | "rolling_back"
  | "rolled_back";

export type ImportErrorCategory =
  | "file_access_error"
  | "parse_error"
  | "duplicate_batch"
  | "duplicate_primary_key"
  | "permission_denied"
  | "validation_error"
  | "database_error"
  | "unknown_error";

export interface ImportConflictDetail {
  rowNumber: number;
  primaryKey: string;
  existingRecordId?: string;
  conflictType: "duplicate_batch_no" | "duplicate_sensor_timestamp" | "duplicate_data_point_id";
  adoptedRule: "skip" | "overwrite" | "abort";
  message: string;
}

export interface ImportOperationLog {
  id: string;
  operationId: string;
  batchNo?: string;
  sourceName: string;
  sourceType: DataSourceType;
  status: ImportOperationStatus;
  startedAt: string;
  completedAt?: string;
  errorCategory?: ImportErrorCategory;
  errorMessage?: string;
  adoptedRules: Array<{
    ruleType: string;
    ruleDescription: string;
    affectedRecords: number;
  }>;
  conflicts: ImportConflictDetail[];
  timeConfig: TimeParseConfig;
  recordCounts: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    skippedRows: number;
    importedRows: number;
  };
  hasBOM?: boolean;
  userId?: string;
  metadata?: Record<string, unknown>;
}

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
