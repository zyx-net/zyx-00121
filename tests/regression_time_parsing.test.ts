import "fake-indexeddb/auto";

class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] || null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
  get length(): number {
    return Object.keys(this.store).length;
  }
  key(index: number): string | null {
    return Object.keys(this.store)[index] || null;
  }
}

global.localStorage = new LocalStorageMock();

import type {
  RuleVersion,
  DataPoint,
  Batch,
  TimeParseConfig,
  TimeParseConflictLog,
  ImportParseMetadata,
} from "../src/types";
import { db, saveBatchWithData, getFullBatch, saveReviewDecision } from "../src/db/database";
import { detectAnomalies } from "../src/utils/anomalyDetector";
import { computeStatistics, generateId, formatTimestamp } from "../src/utils/statistics";
import {
  parseTimestampWithFormat,
  detectTimeFormat,
  loadTimeParseConfig,
  saveTimeParseConfig,
  generateMixedFormatSampleCSV,
  generateSampleCSV,
  buildDataExportRows,
  TIME_PARSE_CONFIG_KEY,
} from "../src/utils/csvParser";
import {
  exportReportCSV,
  exportTimeParseAuditLog,
  generateReportFilename,
  generateAuditLogFilename,
} from "../src/utils/reportExporter";
import { collapseDecisions, getDecisionHistory } from "../src/utils/decisionHistory";

console.log("\n" + "=".repeat(80));
console.log("  车间传感器质检分析工具 - 时间解析增强功能 回归测试套件");
console.log("=".repeat(80));

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(
      `❌ 断言失败: ${message}\n  实际: ${actualStr}\n  期望: ${expectedStr}`
    );
  }
  console.log(`  ✅ ${message}`);
}

function assertTruthy(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`❌ 断言失败: ${message}`);
  }
  console.log(`  ✅ ${message}`);
}

function assertContains(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`❌ 断言失败: ${message}\n  期望包含: "${needle}"`);
  }
  console.log(`  ✅ ${message}`);
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createDefaultRule(): RuleVersion {
  const devId = generateId("dev");
  return {
    id: generateId("rv"),
    name: "时间解析测试规则",
    version: 1,
    createdAt: new Date().toISOString(),
    description: "用于时间解析功能测试的规则",
    devices: [{ id: devId, name: "测试生产线", code: "TEST-001" }],
    sensorRules: [
      {
        id: generateId("sr"),
        deviceId: devId,
        sensorName: "Temperature_A1",
        minValue: 40,
        maxValue: 100,
        jumpThreshold: 30,
        unit: "℃",
      },
      {
        id: generateId("sr"),
        deviceId: devId,
        sensorName: "Pressure_B2",
        minValue: 1.0,
        maxValue: 5.0,
        jumpThreshold: 1.5,
        unit: "MPa",
      },
      {
        id: generateId("sr"),
        deviceId: devId,
        sensorName: "Vibration_C3",
        minValue: 0.1,
        maxValue: 2.0,
        jumpThreshold: 0.8,
        unit: "mm/s",
      },
    ],
    missingRules: [
      { id: generateId("mr"), sensorName: "Temperature_A1", maxGapSeconds: 120, maxConsecutiveMissing: 2 },
      { id: generateId("mr"), sensorName: "Pressure_B2", maxGapSeconds: 120, maxConsecutiveMissing: 2 },
      { id: generateId("mr"), sensorName: "Vibration_C3", maxGapSeconds: 120, maxConsecutiveMissing: 2 },
    ],
  };
}

function parseCSVString(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const result: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row: Record<string, string> = {};
    header.forEach((h, idx) => {
      row[h.trim()] = cols[idx]?.trim() || "";
    });
    result.push(row);
  }
  return result;
}

function processCSVWithConfig(
  rows: Array<Record<string, string>>,
  rule: RuleVersion,
  timeConfig: TimeParseConfig
): { dataPoints: DataPoint[]; parseMetadata: ImportParseMetadata; errors: string[] } {
  const dataPoints: DataPoint[] = [];
  const conflicts: TimeParseConflictLog[] = [];
  const autoDetectedFormatCounts: Record<string, number> = {};
  const parseErrors: Array<{ row: number; rawValue: string; message: string }> = [];
  const errors: string[] = [];
  const validSensorNames = new Set(rule.sensorRules.map(s => s.sensorName));

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const tsRaw = row.timestamp || row.time || "";
    const sensorName = row.sensor || row.sensorName || "";
    const valueRaw = row.value || row.val || row.reading || "";

    const detectedFormat = detectTimeFormat(tsRaw);
    autoDetectedFormatCounts[detectedFormat] = (autoDetectedFormatCounts[detectedFormat] || 0) + 1;

    const autoParsed = parseTimestampWithFormat(tsRaw, "auto");
    const userParsed = timeConfig.preset !== "auto"
      ? parseTimestampWithFormat(tsRaw, timeConfig.preset, timeConfig.customFormat)
      : autoParsed;

    let finalTs: Date | null = null;
    let parseNote: string | undefined;
    let conflictReason: string | undefined;

    if (timeConfig.preset !== "auto" && autoParsed && userParsed) {
      const autoIso = autoParsed.toISOString();
      const userIso = userParsed.toISOString();
      if (autoIso !== userIso) {
        conflictReason = `自动识别格式(${detectedFormat})与手动配置(${timeConfig.preset})解析结果不一致`;
        finalTs = userParsed;
        parseNote = `使用手动配置(${timeConfig.preset})，自动识别(${detectedFormat})结果: ${autoIso}`;

        conflicts.push({
          id: generateId("tconflict"),
          rowNumber: rowNum,
          rawValue: tsRaw,
          autoDetectedFormat: detectedFormat,
          userSelectedFormat: timeConfig.preset,
          autoParsedTimestamp: autoIso,
          userParsedTimestamp: userIso,
          finalTimestamp: userIso,
          finalFormatUsed: timeConfig.preset,
          conflictReason,
          resolvedAt: new Date().toISOString(),
        });
      } else {
        finalTs = userParsed;
      }
    } else {
      finalTs = userParsed;
    }

    if (!finalTs) {
      const msg = `无效的时间戳格式: "${tsRaw}"`;
      errors.push(msg);
      parseErrors.push({ row: rowNum, rawValue: tsRaw, message: msg });
      return;
    }

    if (!sensorName || !validSensorNames.has(sensorName)) {
      errors.push(`未知传感器: "${sensorName}"`);
      return;
    }

    const value = Number(valueRaw);
    if (isNaN(value)) {
      errors.push(`无效的数值: "${valueRaw}"`);
      return;
    }

    dataPoints.push({
      id: `dp_${rowNum}_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: finalTs.toISOString(),
      rawTimestamp: tsRaw,
      sensorName,
      value,
      timeParseNote: parseNote,
    });
  });

  return {
    dataPoints,
    errors,
    parseMetadata: {
      timeConfig,
      conflicts,
      autoDetectedFormatCounts,
      parseErrors,
      importedAt: new Date().toISOString(),
    },
  };
}

async function runTimeParsingTests() {
  console.log("\n🧪 初始化测试环境（IndexedDB）");
  await db.delete();
  await db.open();

  const rule = createDefaultRule();
  await db.ruleVersions.put(rule);

  console.log("\n📋 测试 1: 时间格式检测 - 各种格式的自动识别");
  {
    const testCases = [
      { input: "2024-01-15 08:00:00", expected: "iso_standard" },
      { input: "2024/01/15 08:00:00", expected: "cn_slash_format" },
      { input: "1704067200", expected: "unix_seconds" },
      { input: "1704067200000", expected: "unix_milliseconds" },
      { input: "2024-01-15T08:00:00Z", expected: "iso_standard" },
      { input: "20240115_080000", expected: "compact_format" },
      { input: "2024-01-15", expected: "date_only" },
      { input: "invalid_date", expected: "unknown" },
      { input: "", expected: "empty" },
      { input: "Mon, 15 Jan 2024 08:00:00 GMT", expected: "js_date_parseable" },
    ];

    for (const tc of testCases) {
      const detected = detectTimeFormat(tc.input);
      assertEqual(detected, tc.expected, `识别 "${tc.input}" → ${tc.expected}`);
    }
  }

  console.log("\n📋 测试 2: 秒级 Unix 时间戳解析");
  {
    const ts = 1705296000;
    const parsed = parseTimestampWithFormat(String(ts), "unix_seconds");
    assertTruthy(parsed !== null, "秒级时间戳解析成功");
    assertEqual(parsed?.getUTCFullYear(), 2024, "年份正确");
    assertEqual(parsed?.getUTCMonth(), 0, "月份正确");
    assertEqual(parsed?.getUTCDate(), 15, "日期正确");
  }

  console.log("\n📋 测试 3: 毫秒级 Unix 时间戳解析");
  {
    const ts = 1705296000000;
    const parsed = parseTimestampWithFormat(String(ts), "unix_milliseconds");
    assertTruthy(parsed !== null, "毫秒级时间戳解析成功");
    assertEqual(parsed?.getUTCFullYear(), 2024, "年份正确");
    assertEqual(parsed?.getTime(), ts, "时间戳精确到毫秒");
  }

  console.log("\n📋 测试 4: 自定义格式解析");
  {
    const customFormats = [
      { format: "YYYY-MM-DD HH:mm:ss", input: "2024-01-15 08:30:45" },
      { format: "YYYY/MM/DD HH:mm:ss", input: "2024/01/15 08:30:45" },
      { format: "DD-MM-YYYY HH:mm:ss", input: "15-01-2024 08:30:45" },
      { format: "MM/DD/YYYY HH:mm:ss", input: "01/15/2024 08:30:45" },
      { format: "YYYYMMDD_HHmmss", input: "20240115_083045" },
    ];

    for (const cf of customFormats) {
      const parsed = parseTimestampWithFormat(cf.input, "custom", cf.format);
      assertTruthy(parsed !== null, `自定义格式 ${cf.format} 解析成功`);
      assertEqual(parsed?.getFullYear(), 2024, `${cf.format} - 年份正确`);
      assertEqual(parsed?.getMonth(), 0, `${cf.format} - 月份正确`);
      assertEqual(parsed?.getDate(), 15, `${cf.format} - 日期正确`);
      assertEqual(parsed?.getHours(), 8, `${cf.format} - 小时正确`);
      assertEqual(parsed?.getMinutes(), 30, `${cf.format} - 分钟正确`);
      assertEqual(parsed?.getSeconds(), 45, `${cf.format} - 秒正确`);
    }
  }

  console.log("\n📋 测试 5: 用户配置跨重启持久化 (localStorage)");
  {
    const testConfig: TimeParseConfig = { preset: "unix_seconds" };
    saveTimeParseConfig(testConfig);
    
    const loaded = loadTimeParseConfig();
    assertEqual(loaded.preset, "unix_seconds", "配置已保存到 localStorage");
    
    localStorage.removeItem(TIME_PARSE_CONFIG_KEY);
    const defaultConfig = loadTimeParseConfig();
    assertEqual(defaultConfig.preset, "auto", "无配置时返回默认值 auto");
    
    const customConfig: TimeParseConfig = { preset: "custom", customFormat: "YYYY-MM-DD HH:mm:ss" };
    saveTimeParseConfig(customConfig);
    const loadedCustom = loadTimeParseConfig();
    assertEqual(loadedCustom.preset, "custom", "自定义格式预设已保存");
    assertEqual(loadedCustom.customFormat, "YYYY-MM-DD HH:mm:ss", "自定义格式字符串已保存");
  }

  console.log("\n📋 测试 6: 混合格式数据的解析和冲突检测");
  {
    const mixedCSV = generateMixedFormatSampleCSV();
    const rows = parseCSVString(mixedCSV);
    assertTruthy(rows.length > 0, `混合格式样例包含 ${rows.length} 条数据`);

    const autoConfig: TimeParseConfig = { preset: "auto" };
    const autoResult = processCSVWithConfig(rows, rule, autoConfig);
    assertTruthy(autoResult.dataPoints.length > 0, `自动识别模式下解析出 ${autoResult.dataPoints.length} 条有效数据`);
    assertEqual(autoResult.parseMetadata.conflicts.length, 0, "自动识别模式下无冲突");

    const formatCounts = Object.keys(autoResult.parseMetadata.autoDetectedFormatCounts).length;
    assertTruthy(formatCounts >= 3, `自动检测到至少 3 种不同格式（实际: ${formatCounts}）`);

    const unixConfig: TimeParseConfig = { preset: "unix_milliseconds" };
    const unixResult = processCSVWithConfig(rows, rule, unixConfig);
    assertTruthy(unixResult.parseMetadata.conflicts.length > 0, `手动配置毫秒级Unix时检测到 ${unixResult.parseMetadata.conflicts.length} 条冲突`);

    const firstConflict = unixResult.parseMetadata.conflicts[0];
    assertTruthy(firstConflict.autoParsedTimestamp !== null, "冲突记录包含自动解析结果");
    assertTruthy(firstConflict.userParsedTimestamp !== null, "冲突记录包含手动解析结果");
    assertTruthy(firstConflict.autoParsedTimestamp !== firstConflict.userParsedTimestamp, "两种解析结果确实不同");
    assertEqual(firstConflict.finalFormatUsed, "unix_milliseconds", "最终使用手动配置的格式");

    unixResult.dataPoints.forEach(dp => {
      assertTruthy(dp.rawTimestamp !== undefined, "每条数据都保留了原始时间戳");
      assertTruthy(dp.timestamp !== undefined, "每条数据都有标准化时间戳");
    });

    const withNote = unixResult.dataPoints.filter(dp => dp.timeParseNote !== undefined);
    assertTruthy(withNote.length > 0, `存在 ${withNote.length} 条数据带有时间解析说明`);
  }

  console.log("\n📋 测试 7: 解析元数据随批次保存到数据库");
  {
    const mixedCSV = generateMixedFormatSampleCSV();
    const rows = parseCSVString(mixedCSV);
    const config: TimeParseConfig = { preset: "unix_milliseconds" };
    const result = processCSVWithConfig(rows, rule, config);

    const anomalies = detectAnomalies(result.dataPoints, rule);
    const batchNo = `TEST-TIME-${Date.now()}`;
    const batch: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "时间解析测试批次",
      totalRows: result.dataPoints.length,
      status: "reviewing",
      dataPoints: result.dataPoints,
      anomalies,
      decisions: [],
      rollbackLogs: [],
      parseMetadata: result.parseMetadata,
    };

    await saveBatchWithData(batch);
    const savedBatch = await getFullBatch(batch.id);

    assertTruthy(savedBatch !== undefined, "批次已保存");
    assertTruthy(savedBatch?.parseMetadata !== undefined, "解析元数据已保存");
    assertEqual(savedBatch?.parseMetadata?.timeConfig.preset, "unix_milliseconds", "时间配置已保存");
    assertEqual(savedBatch?.parseMetadata?.conflicts.length, result.parseMetadata.conflicts.length, "冲突记录数量一致");
    
    savedBatch?.dataPoints.forEach(dp => {
      assertTruthy(dp.rawTimestamp !== undefined, "数据库中的数据点保留了原始时间戳");
    });

    const firstConflict = savedBatch?.parseMetadata?.conflicts[0];
    assertTruthy(firstConflict?.id !== undefined, "冲突记录ID已保存");
    assertTruthy(firstConflict?.resolvedAt !== undefined, "冲突解决时间已保存");
  }

  console.log("\n📋 测试 8: 数据导出包含原始时间戳、标准化时间和异常说明");
  {
    const mixedCSV = generateMixedFormatSampleCSV();
    const rows = parseCSVString(mixedCSV);
    const config: TimeParseConfig = { preset: "unix_seconds" };
    const result = processCSVWithConfig(rows, rule, config);

    const anomalies = detectAnomalies(result.dataPoints, rule);
    const batchNo = `TEST-EXPORT-${Date.now()}`;
    const batch: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "导出测试批次",
      totalRows: result.dataPoints.length,
      status: "reviewing",
      dataPoints: result.dataPoints,
      anomalies,
      decisions: [],
      rollbackLogs: [],
      parseMetadata: result.parseMetadata,
    };

    const stats = computeStatistics(anomalies, []);
    const reportCSV = exportReportCSV(batch, rule, stats);

    assertContains(reportCSV, "原始时间戳", "报告包含原始时间戳列");
    assertContains(reportCSV, "标准化时间", "报告包含标准化时间列");
    assertContains(reportCSV, "时间格式说明", "报告包含时间格式说明列");
    assertContains(reportCSV, "时间解析配置", "报告头部包含时间解析配置");
    assertContains(reportCSV, "时间解析冲突数", "报告头部包含冲突数量");

    if (result.parseMetadata.conflicts.length > 0) {
      assertContains(reportCSV, "时间解析冲突日志（可追溯）", "报告包含冲突日志章节");
      assertContains(reportCSV, "冲突原因", "报告包含冲突原因列");
    }

    assertContains(reportCSV, "原始数据清单（含时间解析信息）", "报告包含原始数据清单");
    assertContains(reportCSV, "自动检测格式分布统计", "报告包含格式分布统计");

    const exportRows = buildDataExportRows(result.dataPoints, result.parseMetadata);
    assertEqual(exportRows.length, result.dataPoints.length, "导出行数与数据点数一致");
    
    const firstRow = exportRows[0];
    assertTruthy(firstRow["原始时间戳"] !== undefined, "导出行包含原始时间戳");
    assertTruthy(firstRow["标准化时间"] !== undefined, "导出行包含标准化时间");
    assertTruthy(firstRow["时间格式说明"] !== undefined, "导出行包含时间格式说明");
    assertTruthy(firstRow["最终使用格式"] !== undefined, "导出行包含最终使用格式");
  }

  console.log("\n📋 测试 9: 审计日志导出功能");
  {
    const mixedCSV = generateMixedFormatSampleCSV();
    const rows = parseCSVString(mixedCSV);
    const config: TimeParseConfig = { preset: "unix_seconds" };
    const result = processCSVWithConfig(rows, rule, config);

    const anomalies = detectAnomalies(result.dataPoints, rule);
    const batchNo = `TEST-AUDIT-${Date.now()}`;
    const batch: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "审计日志测试批次",
      totalRows: result.dataPoints.length,
      status: "reviewing",
      dataPoints: result.dataPoints,
      anomalies,
      decisions: [],
      rollbackLogs: [],
      parseMetadata: result.parseMetadata,
    };

    const auditLog = exportTimeParseAuditLog(batch);
    
    assertContains(auditLog, "时间解析审计日志", "审计日志包含标题");
    assertContains(auditLog, "使用的时间预设", "审计日志包含使用的预设");
    assertContains(auditLog, "冲突日志", "审计日志包含冲突日志章节");
    assertContains(auditLog, "解析错误日志", "审计日志包含解析错误日志章节");
    assertContains(auditLog, "格式分布统计", "审计日志包含格式分布统计");
    assertContains(auditLog, "自动识别格式", "审计日志包含自动识别格式列");
    assertContains(auditLog, "手动配置格式", "审计日志包含手动配置格式列");
    assertContains(auditLog, "最终采用结果", "审计日志包含最终采用结果列");

    const reportFilename = generateReportFilename(batchNo);
    assertTruthy(reportFilename.includes(batchNo), "报告文件名包含批次号");
    
    const auditFilename = generateAuditLogFilename(batchNo);
    assertTruthy(auditFilename.includes(batchNo), "审计日志文件名包含批次号");
    assertTruthy(auditFilename.includes("TimeParse_AuditLog"), "审计日志文件名有正确前缀");
  }

  console.log("\n📋 测试 10: 撤销后重新导入复现相同结果（可重现性）");
  {
    const mixedCSV = generateMixedFormatSampleCSV();
    const rows = parseCSVString(mixedCSV);
    const config: TimeParseConfig = { preset: "unix_seconds" };

    const firstResult = processCSVWithConfig(rows, rule, config);
    const anomalies1 = detectAnomalies(firstResult.dataPoints, rule);
    const batchNo = `TEST-REPRO-${Date.now()}`;
    const batch1: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "可重现性测试批次 - 第一次",
      totalRows: firstResult.dataPoints.length,
      status: "reviewing",
      dataPoints: firstResult.dataPoints,
      anomalies: anomalies1,
      decisions: [],
      rollbackLogs: [],
      parseMetadata: firstResult.parseMetadata,
    };

    await saveBatchWithData(batch1);
    await wait(50);

    await db.batches.delete(batch1.id);
    await db.dataPoints.where("batchId").equals(batch1.id).delete();
    await db.anomalies.where("batchId").equals(batch1.id).delete();

    await wait(100);

    const savedConfig = batch1.parseMetadata?.timeConfig;
    assertTruthy(savedConfig !== undefined, "保存的配置可用于重新导入");

    const secondResult = processCSVWithConfig(rows, rule, savedConfig!);
    const anomalies2 = detectAnomalies(secondResult.dataPoints, rule);
    const batch2: Batch = {
      id: generateId("batch"),
      batchNo: `${batchNo}-REPEAT`,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "可重现性测试批次 - 第二次",
      totalRows: secondResult.dataPoints.length,
      status: "reviewing",
      dataPoints: secondResult.dataPoints,
      anomalies: anomalies2,
      decisions: [],
      rollbackLogs: [],
      parseMetadata: secondResult.parseMetadata,
    };

    assertEqual(secondResult.dataPoints.length, firstResult.dataPoints.length, "重新导入的数据量相同");
    assertEqual(secondResult.parseMetadata.conflicts.length, firstResult.parseMetadata.conflicts.length, "重新导入的冲突数量相同");
    assertEqual(anomalies2.length, anomalies1.length, "重新导入检测到的异常数量相同");
    assertEqual(secondResult.parseMetadata.timeConfig.preset, firstResult.parseMetadata.timeConfig.preset, "重新导入使用的预设相同");

    for (let i = 0; i < Math.min(5, firstResult.dataPoints.length); i++) {
      assertEqual(secondResult.dataPoints[i].rawTimestamp, firstResult.dataPoints[i].rawTimestamp, `第 ${i} 条原始时间戳相同`);
      assertEqual(secondResult.dataPoints[i].timestamp, firstResult.dataPoints[i].timestamp, `第 ${i} 条标准化时间戳相同`);
      assertEqual(secondResult.dataPoints[i].sensorName, firstResult.dataPoints[i].sensorName, `第 ${i} 条传感器名称相同`);
      assertEqual(secondResult.dataPoints[i].value, firstResult.dataPoints[i].value, `第 ${i} 条数值相同`);
    }

    for (let i = 0; i < Math.min(3, firstResult.parseMetadata.conflicts.length); i++) {
      assertEqual(secondResult.parseMetadata.conflicts[i].rowNumber, firstResult.parseMetadata.conflicts[i].rowNumber, `冲突 ${i} 行号相同`);
      assertEqual(secondResult.parseMetadata.conflicts[i].rawValue, firstResult.parseMetadata.conflicts[i].rawValue, `冲突 ${i} 原始值相同`);
      assertEqual(secondResult.parseMetadata.conflicts[i].finalFormatUsed, firstResult.parseMetadata.conflicts[i].finalFormatUsed, `冲突 ${i} 最终格式相同`);
    }
  }

  console.log("\n📋 测试 11: 重启后数据完整性（数据库持久化验证）");
  {
    const mixedCSV = generateMixedFormatSampleCSV();
    const rows = parseCSVString(mixedCSV);
    const config: TimeParseConfig = { preset: "custom", customFormat: "YYYY-MM-DD HH:mm:ss" };
    const result = processCSVWithConfig(rows, rule, config);

    const anomalies = detectAnomalies(result.dataPoints, rule);
    const batchNo = `TEST-RESTART-${Date.now()}`;
    const batch: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "重启测试批次",
      totalRows: result.dataPoints.length,
      status: "reviewing",
      dataPoints: result.dataPoints,
      anomalies,
      decisions: [],
      rollbackLogs: [],
      parseMetadata: result.parseMetadata,
    };

    const decision = await saveReviewDecision(batch.id, {
      id: generateId("dec"),
      anomalyId: anomalies[0].id,
      label: "confirmed_fault",
      reviewedAt: new Date().toISOString(),
      comment: "测试决策",
    });

    await saveBatchWithData(batch);
    await wait(50);

    await db.close();
    await wait(200);
    await db.open();

    const reloadedBatch = await getFullBatch(batch.id);
    assertTruthy(reloadedBatch !== undefined, "重启后批次可加载");
    assertEqual(reloadedBatch?.dataPoints.length, batch.dataPoints.length, "重启后数据点数量一致");
    assertEqual(reloadedBatch?.parseMetadata?.conflicts.length, batch.parseMetadata?.conflicts.length, "重启后冲突记录数量一致");
    assertEqual(reloadedBatch?.parseMetadata?.timeConfig.preset, "custom", "重启后时间配置正确");
    assertEqual(reloadedBatch?.parseMetadata?.timeConfig.customFormat, "YYYY-MM-DD HH:mm:ss", "重启后自定义格式正确");
    assertEqual(reloadedBatch?.decisions.length, 1, "重启后决策记录保留");

    reloadedBatch?.dataPoints.forEach(dp => {
      assertTruthy(dp.rawTimestamp !== undefined, "重启后原始时间戳保留");
      assertTruthy(dp.timestamp !== undefined, "重启后标准化时间戳保留");
    });

    const reloadedStats = computeStatistics(reloadedBatch!.anomalies, reloadedBatch!.decisions);
    assertEqual(reloadedStats.byLabel.confirmed_fault, 1, "重启后统计正确");
  }

  console.log("\n📋 测试 12: 标准格式数据的导入-回看-导出完整链路");
  {
    const standardCSV = generateSampleCSV();
    const rows = parseCSVString(standardCSV);
    const config: TimeParseConfig = { preset: "auto" };
    const result = processCSVWithConfig(rows, rule, config);

    assertEqual(result.parseMetadata.conflicts.length, 0, "标准格式数据无解析冲突");
    assertTruthy(result.dataPoints.length > 150, `解析出 ${result.dataPoints.length} 条有效数据`);

    const anomalies = detectAnomalies(result.dataPoints, rule);
    const batchNo = `TEST-FULL-LINK-${Date.now()}`;
    const batch: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "完整链路测试批次",
      totalRows: result.dataPoints.length,
      status: "reviewing",
      dataPoints: result.dataPoints,
      anomalies,
      decisions: [],
      rollbackLogs: [],
      parseMetadata: result.parseMetadata,
    };

    await saveBatchWithData(batch);
    const savedBatch = await getFullBatch(batch.id);
    assertTruthy(savedBatch !== undefined, "批次导入成功");

    for (let i = 0; i < 3; i++) {
      await saveReviewDecision(batch.id, {
        id: generateId("dec"),
        anomalyId: anomalies[i].id,
        label: i === 0 ? "confirmed_fault" : i === 1 ? "false_positive" : "ignored",
        reviewedAt: new Date().toISOString(),
        comment: `决策 ${i + 1}`,
      });
      await wait(50);
    }

    const reviewedBatch = await getFullBatch(batch.id);
    const stats = computeStatistics(reviewedBatch!.anomalies, reviewedBatch!.decisions);
    assertEqual(stats.byLabel.confirmed_fault, 1, "1 个确认故障");
    assertEqual(stats.byLabel.false_positive, 1, "1 个误报");
    assertEqual(stats.byLabel.ignored, 1, "1 个忽略");

    const report = exportReportCSV(reviewedBatch!, rule, stats);
    assertContains(report, "原始时间戳", "导出报告包含原始时间戳");
    assertContains(report, "标准化时间", "导出报告包含标准化时间");
    assertContains(report, batchNo, "导出报告包含批次号");
    assertContains(report, "确认故障", "导出报告包含确认故障标签");
    assertContains(report, "误报", "导出报告包含误报标签");
    assertContains(report, "忽略", "导出报告包含忽略标签");

    await db.close();
    await wait(200);
    await db.open();

    const finalBatch = await getFullBatch(batch.id);
    const finalStats = computeStatistics(finalBatch!.anomalies, finalBatch!.decisions);
    assertEqual(finalStats.byLabel.confirmed_fault, stats.byLabel.confirmed_fault, "重启后确认故障数一致");
    assertEqual(finalStats.byLabel.false_positive, stats.byLabel.false_positive, "重启后误报数一致");
    assertEqual(finalStats.byLabel.ignored, stats.byLabel.ignored, "重启后忽略数一致");
    assertEqual(finalStats.completionRate, stats.completionRate, "重启后完成率一致");
    assertEqual(finalBatch?.parseMetadata?.conflicts.length, 0, "重启后冲突记录正确");
  }

  console.log("\n" + "=".repeat(80));
  console.log("🎉 时间解析增强功能 所有回归测试通过！");
  console.log("=".repeat(80));
  console.log("\n✅ 验证覆盖的场景:");
  console.log("   1. 时间格式自动识别（多种格式）");
  console.log("   2. 秒级/毫秒级 Unix 时间戳解析");
  console.log("   3. 自定义格式解析");
  console.log("   4. 用户配置跨重启持久化（localStorage）");
  console.log("   5. 混合格式数据的解析和冲突检测");
  console.log("   6. 解析元数据随批次保存到数据库");
  console.log("   7. 数据导出包含原始时间戳、标准化时间和异常说明");
  console.log("   8. 审计日志导出功能");
  console.log("   9. 撤销后重新导入复现相同结果（可重现性）");
  console.log("   10. 重启后数据完整性验证");
  console.log("   11. 标准格式数据的导入-回看-导出-重启完整链路");
  console.log("   12. 冲突日志的可追溯性（行号、原始值、原因、最终结果）");
  console.log("\n");
}

runTimeParsingTests().catch(err => {
  console.error("\n❌ 时间解析回归测试失败:", err);
  process.exit(1);
});
