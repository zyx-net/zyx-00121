import Papa from "papaparse";
import type {
  Anomaly,
  Batch,
  ReviewDecision,
  RollbackLog,
  RuleVersion,
  StatisticsSummary,
  DataPoint,
} from "@/types";
import { ANOMALY_TYPE_META, REVIEW_LABEL_META } from "@/types";
import { computeStatistics, formatTimestamp } from "./statistics";
import { collapseDecisions, getDecisionHistory } from "@/utils/decisionHistory";
import { buildDataExportRows } from "./csvParser";

interface ExportRow {
  异常编号: string;
  异常类型: string;
  传感器: string;
  原始时间戳: string;
  标准化时间: string;
  当前值: string;
  期望值: string;
  前值: string;
  后值: string;
  异常描述: string;
  时间格式说明: string;
  复核标签: string;
  复核时间: string;
  复核备注: string;
  历史标签变更: string;
}

interface DataExportRow {
  行号: number;
  原始时间戳: string;
  标准化时间: string;
  传感器名称: string;
  数值: number;
  时间格式说明: string;
  最终使用格式: string;
}

interface ConflictExportRow {
  行号: number;
  原始值: string;
  自动识别格式: string;
  手动配置格式: string;
  自动解析结果: string;
  手动解析结果: string;
  最终采用结果: string;
  冲突原因: string;
  解决时间: string;
}

export function exportReportCSV(
  batch: Batch,
  ruleVersion: RuleVersion,
  stats: StatisticsSummary
): string {
  const latestDecisions = collapseDecisions(batch.decisions);
  const decisionMap = new Map(latestDecisions.map((d) => [d.anomalyId, d]));
  const dataPointMap = new Map(batch.dataPoints.map((dp) => [`${dp.sensorName}__${dp.timestamp}`, dp]));

  const headerInfo = [
    ["# 车间传感器质检分析报告"],
    ["批次编号", batch.batchNo],
    ["导入时间", formatTimestamp(batch.importedAt)],
    ["数据量", String(batch.totalRows)],
    ["规则版本", `${ruleVersion.name} (v${ruleVersion.version})`],
    ["检测时间", formatTimestamp(new Date().toISOString())],
    ["时间解析配置", batch.parseMetadata?.timeConfig?.preset || "auto"],
    ["时间解析冲突数", String(batch.parseMetadata?.conflicts?.length || 0)],
    [""],
    ["# 统计摘要"],
    ["异常总数", String(stats.totalAnomalies)],
    ["确认故障", String(stats.byLabel.confirmed_fault)],
    ["误报", String(stats.byLabel.false_positive)],
    ["忽略", String(stats.byLabel.ignored)],
    ["未复核", String(stats.byLabel.unreviewed)],
    ["复核完成率", `${stats.completionRate.toFixed(1)}%`],
    ["故障确认率", `${stats.confirmedFaultRate.toFixed(1)}%`],
    ["误报率", `${stats.falsePositiveRate.toFixed(1)}%`],
    [""],
    ["按异常类型分布:"],
    ...Object.entries(stats.byType).map(([k, v]) => [
      ANOMALY_TYPE_META[k as keyof typeof ANOMALY_TYPE_META].name,
      String(v),
    ]),
    [""],
    ["按传感器分布:"],
    ...Object.entries(stats.bySensor).map(([k, v]) => [k, String(v)]),
    [""],
  ];

  const rows: ExportRow[] = batch.anomalies.map((a) => {
    const d = decisionMap.get(a.id);
    const dp = dataPointMap.get(`${a.sensorName}__${a.timestamp}`);
    const history = getDecisionHistory(batch.decisions, a.id);
    const historyStr = history.length > 1
      ? history.map((h, i) =>
          `${i + 1}. ${REVIEW_LABEL_META[h.label].name} (${formatTimestamp(h.reviewedAt)})`
        ).join("; ")
      : (d ? "无变更" : "-");

    return {
      异常编号: a.id,
      异常类型: ANOMALY_TYPE_META[a.type].name,
      传感器: a.sensorName,
      原始时间戳: dp?.rawTimestamp || a.timestamp,
      标准化时间: formatTimestamp(a.timestamp),
      当前值: a.value === null ? "-" : String(a.value),
      期望值: a.expectedValue !== undefined ? String(a.expectedValue) : "-",
      前值: a.previousValue !== undefined ? String(a.previousValue) : "-",
      后值: a.nextValue !== undefined ? String(a.nextValue) : "-",
      异常描述: a.description,
      时间格式说明: dp?.timeParseNote || "",
      复核标签: d ? REVIEW_LABEL_META[d.label].name : "未复核",
      复核时间: d ? formatTimestamp(d.reviewedAt) : "-",
      复核备注: d?.comment ?? "-",
      历史标签变更: historyStr,
    };
  });

  const dataRows = buildDataExportRows(batch.dataPoints, batch.parseMetadata);
  const conflictRows: ConflictExportRow[] = (batch.parseMetadata?.conflicts || []).map((c) => ({
    行号: c.rowNumber,
    原始值: c.rawValue,
    自动识别格式: c.autoDetectedFormat,
    手动配置格式: c.userSelectedFormat,
    自动解析结果: c.autoParsedTimestamp || "-",
    手动解析结果: c.userParsedTimestamp || "-",
    最终采用结果: c.finalTimestamp || "-",
    冲突原因: c.conflictReason,
    解决时间: formatTimestamp(c.resolvedAt),
  }));

  const allRows: unknown[][] = [
    ...headerInfo,
    ["# 异常清单"],
    Object.keys(rows[0] || {}),
    ...rows.map((r) => Object.values(r)),
    [""],
    ["# 原始数据清单（含时间解析信息）"],
    dataRows.length > 0 ? Object.keys(dataRows[0]) : [],
    ...dataRows.map((r) => Object.values(r)),
  ];

  if (conflictRows.length > 0) {
    allRows.push(
      [""],
      ["# 时间解析冲突日志（可追溯）"],
      Object.keys(conflictRows[0]),
      ...conflictRows.map((r) => Object.values(r))
    );
  }

  if (batch.parseMetadata?.autoDetectedFormatCounts) {
    allRows.push(
      [""],
      ["# 自动检测格式分布统计"],
      ["格式类型", "行数"],
      ...Object.entries(batch.parseMetadata.autoDetectedFormatCounts).map(([k, v]) => [k, String(v)])
    );
  }

  const csv = Papa.unparse({
    fields: [],
    data: allRows,
  });

  return "\uFEFF" + csv;
}

export function exportTimeParseAuditLog(
  batch: Batch
): string {
  const parseMetadata = batch.parseMetadata;
  if (!parseMetadata) {
    return "\uFEFF# 该批次无时间解析元数据";
  }

  const headerInfo = [
    ["# 时间解析审计日志"],
    ["批次编号", batch.batchNo],
    ["导入时间", formatTimestamp(batch.importedAt)],
    ["使用的时间预设", parseMetadata.timeConfig.preset],
    ["自定义格式", parseMetadata.timeConfig.customFormat || "-"],
    ["冲突记录数", String(parseMetadata.conflicts.length)],
    ["解析错误数", String(parseMetadata.parseErrors.length)],
    [""],
  ];

  const conflictRows = parseMetadata.conflicts.map((c) => ({
    行号: c.rowNumber,
    原始值: c.rawValue,
    自动识别格式: c.autoDetectedFormat,
    手动配置格式: c.userSelectedFormat,
    自动解析结果: c.autoParsedTimestamp || "-",
    手动解析结果: c.userParsedTimestamp || "-",
    最终采用结果: c.finalTimestamp || "-",
    最终使用格式: c.finalFormatUsed,
    冲突原因: c.conflictReason,
    解决时间: formatTimestamp(c.resolvedAt),
  }));

  const errorRows = parseMetadata.parseErrors.map((e) => ({
    行号: e.row,
    原始值: e.rawValue,
    错误信息: e.message,
  }));

  const allRows: unknown[][] = [
    ...headerInfo,
    ["# 冲突日志"],
    conflictRows.length > 0 ? Object.keys(conflictRows[0]) : [],
    ...conflictRows.map((r) => Object.values(r)),
    [""],
    ["# 解析错误日志"],
    errorRows.length > 0 ? Object.keys(errorRows[0]) : [],
    ...errorRows.map((r) => Object.values(r)),
    [""],
    ["# 格式分布统计"],
    ["格式类型", "行数"],
    ...Object.entries(parseMetadata.autoDetectedFormatCounts).map(([k, v]) => [k, String(v)]),
  ];

  const csv = Papa.unparse({
    fields: [],
    data: allRows,
  });

  return "\uFEFF" + csv;
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateReportFilename(batchNo: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `QA_Report_${batchNo}_${stamp}.csv`;
}

export function generateAuditLogFilename(batchNo: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `TimeParse_AuditLog_${batchNo}_${stamp}.csv`;
}

export function buildRollbackTrail(
  batch: { rollbackLogs: RollbackLog[]; ruleVersionId: string },
  ruleVersions: RuleVersion[]
): string[] {
  const ruleMap = new Map(ruleVersions.map((r) => [r.id, r]));
  return batch.rollbackLogs.map((log) => {
    const from = ruleMap.get(log.fromRuleVersionId);
    const to = ruleMap.get(log.toRuleVersionId);
    return `[${formatTimestamp(log.rolledBackAt)}] 回滚 ${from?.name ?? "未知"} v${
      from?.version ?? "?"
    } → ${to?.name ?? "未知"} v${to?.version ?? "?"} 原因: ${log.reason}`;
  });
}

export function quickStats(anomalies: Anomaly[], decisions: ReviewDecision[]) {
  return computeStatistics(anomalies, decisions);
}
