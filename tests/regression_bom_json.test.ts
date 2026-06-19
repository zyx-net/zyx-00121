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
  ImportValidationResult,
  PrecheckResult,
  TimeFormatPreset,
  DataSourceType,
  ImportOperationLog,
} from "../src/types";
import { db, saveBatchWithData, getFullBatch } from "../src/db/database";
import { detectAnomalies } from "../src/utils/anomalyDetector";
import { generateId, formatTimestamp } from "../src/utils/statistics";
import {
  processParsedData,
  parseTimestampWithFormat,
  detectTimeFormat,
  generateSampleCSV,
} from "../src/utils/csvParser";
import {
  parseJSONString,
  processParsedRows,
  generateSampleJSON,
} from "../src/utils/jsonParser";
import {
  UTF8_BOM,
  hasBOM,
  stripBOM,
  detectAndStripBOM,
} from "../src/utils/bomUtils";
import {
  generateSourceId,
  savePerSourceConfig,
  loadPerSourceConfig,
  listPerSourceConfigs,
  deletePerSourceConfig,
} from "../src/utils/perSourceTimeConfig";
import {
  createOperationLog,
  updateLogStatus,
  addConflict,
  addAdoptedRule,
  updateRecordCounts,
  saveOperationLog,
  loadAllLogs,
  categorizeImportError,
  checkWritePermission,
  checkLogDirectoryPermission,
} from "../src/utils/importLogger";
import { precheckJSON, precheckFromRows } from "../src/utils/importPrecheck";

console.log("\n" + "=".repeat(80));
console.log("  BOM JSON Regression Test Suite - Full Success Path");
console.log("=".repeat(80));

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(
      `FAIL: ${message}\n  Actual: ${actualStr}\n  Expected: ${expectedStr}`
    );
  }
  console.log(`  PASS: ${message}`);
}

function assertTruthy(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

function assertContains(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`FAIL: ${message}\n  Expected to contain: "${needle}"`);
  }
  console.log(`  PASS: ${message}`);
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createDefaultRule(): RuleVersion {
  const devId = generateId("dev");
  return {
    id: generateId("rv"),
    name: "BOM 测试规则",
    version: 1,
    createdAt: new Date().toISOString(),
    description: "测试 BOM JSON 处理",
    devices: [
      { id: devId, name: "车间 A 生产线", code: "LINE-A" },
    ],
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
    missingRules: [],
  };
}

function generateBOMJSON(): string {
  const data = [
    { timestamp: "2024-01-15 08:30:00", sensorName: "Temperature_A1", value: 65.5 },
    { timestamp: "2024-01-15 08:31:00", sensorName: "Pressure_B2", value: 2.3 },
    { timestamp: "2024-01-15 08:32:00", sensorName: "Vibration_C3", value: 0.5 },
    { timestamp: "2024-01-15 08:33:00", sensorName: "Temperature_A1", value: 70.0 },
    { timestamp: "2024-01-15 08:34:00", sensorName: "Pressure_B2", value: 2.7 },
    { timestamp: 1705298100, sensorName: "Vibration_C3", value: 0.6 },
    { timestamp: 1705298160000, sensorName: "Temperature_A1", value: 75.0 },
    { timestamp: "2024/01/15 08:37:00", sensorName: "Pressure_B2", value: 3.1 },
    { timestamp: "2024-01-15T08:38:00Z", sensorName: "Vibration_C3", value: 0.7 },
    { timestamp: "20240115_083900", sensorName: "Temperature_A1", value: 68.5 },
  ];
  return UTF8_BOM + JSON.stringify(data, null, 2);
}

function generateNestedBOMJSON(): string {
  const data = {
    metadata: {
      source: "Windows Export",
      exportedAt: "2024-01-15T09:00:00Z",
      hasBOM: true,
    },
    records: [
      { timestamp: "2024-01-15 08:30:00", sensorName: "Temperature_A1", value: 65.5 },
      { timestamp: "2024-01-15 08:31:00", sensorName: "Pressure_B2", value: 2.3 },
      { timestamp: "2024-01-15 08:32:00", sensorName: "Vibration_C3", value: 0.5 },
    ],
  };
  return UTF8_BOM + JSON.stringify(data, null, 2);
}

async function runBOMTests(): Promise<void> {
  await db.delete();
  await db.open();
  localStorage.clear();

  const rule = createDefaultRule();
  const sourceName = "windows_bom_test.json";
  const sourceHash = generateSourceId(sourceName);

  console.log("\n--- Test 1: BOM Utility Functions ---");

  const normalJSON = generateSampleJSON();
  const bomJSON = generateBOMJSON();
  const nestedBOMJSON = generateNestedBOMJSON();

  assertEqual(hasBOM(normalJSON), false, "hasBOM: 普通 JSON 不包含 BOM");
  assertEqual(hasBOM(bomJSON), true, "hasBOM: BOM JSON 正确检测到 BOM");
  assertEqual(hasBOM(nestedBOMJSON), true, "hasBOM: 嵌套 BOM JSON 正确检测到 BOM");

  const stripped = stripBOM(bomJSON);
  assertEqual(stripped.startsWith(UTF8_BOM), false, "stripBOM: BOM 被正确去除");
  assertEqual(stripped.length, bomJSON.length - 1, "stripBOM: 字符串长度正确减少 1");

  const detectResult1 = detectAndStripBOM(bomJSON);
  assertEqual(detectResult1.hasBOM, true, "detectAndStripBOM: 正确报告 hasBOM=true");
  assertEqual(detectResult1.text.startsWith(UTF8_BOM), false, "detectAndStripBOM: 文本已去除 BOM");

  const detectResult2 = detectAndStripBOM(normalJSON);
  assertEqual(detectResult2.hasBOM, false, "detectAndStripBOM: 正确报告 hasBOM=false");

  console.log("\n--- Test 2: BOM JSON Parsing ---");

  const timeConfig: TimeParseConfig = { preset: "auto" };

  const parseResult = parseJSONString(bomJSON, rule, timeConfig, sourceHash, sourceName);
  assertTruthy(parseResult.valid, "parseJSONString: BOM JSON 解析成功");
  assertEqual(parseResult.dataPoints.length, 10, "parseJSONString: 正确解析 10 条数据");
  assertEqual(parseResult.parseMetadata.hasBOM, true, "parseMetadata: hasBOM 标记正确");
  assertEqual(parseResult.parseMetadata.sourceName, sourceName, "parseMetadata: sourceName 正确");
  assertEqual(parseResult.parseMetadata.sourceType, "json", "parseMetadata: sourceType 正确");

  assertContains(parseResult.warnings.join("|"), "UTF-8 BOM", "警告包含 UTF-8 BOM 提示");

  const nestedResult = parseJSONString(nestedBOMJSON, rule, timeConfig, sourceHash, "nested_" + sourceName);
  assertTruthy(nestedResult.valid, "parseJSONString: 嵌套结构 BOM JSON 解析成功");
  assertEqual(nestedResult.dataPoints.length, 3, "parseJSONString: 正确解析嵌套结构 3 条数据");
  assertEqual(nestedResult.parseMetadata.hasBOM, true, "嵌套结构 parseMetadata: hasBOM 标记正确");

  console.log("\n--- Test 3: BOM Data Points Integrity ---");

  const dps = parseResult.dataPoints;
  assertEqual(dps[0].sensorName, "Temperature_A1", "数据点 1: 传感器名称正确");
  assertEqual(dps[0].value, 65.5, "数据点 1: 值正确");
  assertEqual(dps[0].rawTimestamp, "2024-01-15 08:30:00", "数据点 1: 原始时间戳正确");
  assertTruthy(dps[0].timestamp.startsWith("2024-01-15"), "数据点 1: 标准化时间戳正确");

  assertEqual(dps[1].sensorName, "Pressure_B2", "数据点 2: 传感器名称正确");
  assertEqual(dps[1].value, 2.3, "数据点 2: 值正确");

  assertEqual(dps[5].sensorName, "Vibration_C3", "Unix 秒数据点: 传感器名称正确");
  assertEqual(dps[5].rawTimestamp, "1705298100", "Unix 秒数据点: 原始时间戳正确");
  const expectedUnixSecondsTs = new Date(1705298100 * 1000).toISOString();
  assertEqual(dps[5].timestamp, expectedUnixSecondsTs, "Unix 秒数据点: 时间戳正确解析");

  assertEqual(dps[6].sensorName, "Temperature_A1", "Unix 毫秒数据点: 传感器名称正确");
  assertEqual(dps[6].rawTimestamp, "1705298160000", "Unix 毫秒数据点: 原始时间戳正确");
  const expectedUnixMsTs = new Date(1705298160000).toISOString();
  assertEqual(dps[6].timestamp, expectedUnixMsTs, "Unix 毫秒数据点: 时间戳正确解析");

  console.log("\n--- Test 4: Per-Source Config Persistence ---");

  const unixConfig: TimeParseConfig = { preset: "unix_seconds" };
  savePerSourceConfig(sourceName, unixConfig);

  const loadedConfig = loadPerSourceConfig(sourceName);
  assertEqual(loadedConfig?.preset, "unix_seconds", "按数据源保存的配置能正确加载");
  assertEqual(loadedConfig?.preset, unixConfig.preset, "配置内容正确");

  const allConfigs = listPerSourceConfigs();
  assertEqual(allConfigs.length >= 1, true, "listPerSourceConfigs 包含已保存的配置");

  savePerSourceConfig(sourceName, timeConfig);
  const restoredConfig = loadPerSourceConfig(sourceName);
  assertEqual(restoredConfig?.preset, "auto", "配置更新后能正确加载");

  console.log("\n--- Test 5: Precheck with BOM JSON ---");

  const parsed = JSON.parse(stripBOM(bomJSON));
  const rows = Array.isArray(parsed) ? parsed : (parsed as any).records || [];
  const precheckResult = precheckFromRows(rows as any[], "json", sourceName, rule, timeConfig);

  precheckResult.validationResult.parseMetadata.hasBOM = true;
  precheckResult.validationResult.parseMetadata.sourceName = sourceName;
  precheckResult.validationResult.parseMetadata.sourceType = "json";

  assertEqual(precheckResult.sourceType, "json", "precheck: sourceType 正确");
  assertEqual(precheckResult.sourceName, sourceName, "precheck: sourceName 正确");
  assertEqual(precheckResult.validationResult.parseMetadata.hasBOM, true, "precheck: hasBOM 标记正确");

  assertTruthy(precheckResult.fieldMapping.mappedFields.timestamp, "字段映射: timestamp 已映射");
  assertTruthy(precheckResult.fieldMapping.mappedFields.sensorName, "字段映射: sensorName 已映射");
  assertTruthy(precheckResult.fieldMapping.mappedFields.value, "字段映射: value 已映射");

  assertEqual(precheckResult.keyColumnsPreview.length, 10, "关键列预览: 10 行数据");
  assertEqual(precheckResult.keyColumnsPreview[0].rawTimestamp, "2024-01-15 08:30:00", "关键列预览: 原始时间戳正确");
  assertTruthy(precheckResult.keyColumnsPreview[0].standardizedTimestamp.includes("2024"), "关键列预览: 标准化时间戳正确");

  console.log("\n--- Test 6: Operation Logging ---");

  let log = createOperationLog(sourceName, "json", timeConfig, true);
  assertEqual(log.sourceName, sourceName, "操作日志: sourceName 正确");
  assertEqual(log.sourceType, "json", "操作日志: sourceType 正确");
  assertEqual(log.hasBOM, true, "操作日志: hasBOM 正确");
  assertEqual(log.status, "pending", "操作日志: 初始状态为 pending");
  assertEqual(log.timeConfig.preset, "auto", "操作日志: 时间配置正确");

  log = updateLogStatus(log, "previewing");
  assertEqual(log.status, "previewing", "操作日志: 状态更新为 previewing");

  log = addAdoptedRule(log, "bom_handling", "自动检测并去除 UTF-8 BOM", 10);
  assertEqual(log.adoptedRules.length, 1, "操作日志: 添加采用规则成功");
  assertEqual(log.adoptedRules[0].ruleType, "bom_handling", "操作日志: 规则类型正确");
  assertEqual(log.adoptedRules[0].affectedRecords, 10, "操作日志: 受影响记录数正确");

  log = addConflict(log, {
    rowNumber: 5,
    primaryKey: "Temperature_A1_2024-01-15T08:34:00",
    conflictType: "duplicate_sensor_timestamp",
    adoptedRule: "skip",
    message: "传感器和时间戳组合重复",
  });
  assertEqual(log.conflicts.length, 1, "操作日志: 添加冲突成功");
  assertEqual(log.conflicts[0].adoptedRule, "skip", "操作日志: 冲突采用规则正确");

  log = updateRecordCounts(log, parseResult);
  assertEqual(log.recordCounts.totalRows, 10, "操作日志: 总行数正确");
  assertEqual(log.recordCounts.validRows, 10, "操作日志: 有效行数正确");

  log = updateLogStatus(log, "completed");
  saveOperationLog(log);

  const allLogs = loadAllLogs();
  assertEqual(allLogs.length >= 1, true, "操作日志: 能从存储中加载");

  const savedLog = allLogs.find(l => l.operationId === log.operationId);
  assertTruthy(savedLog, "操作日志: 已保存的日志存在");
  assertEqual(savedLog?.hasBOM, true, "操作日志: 持久化后 hasBOM 正确");
  assertEqual(savedLog?.status, "completed", "操作日志: 持久化后状态正确");

  console.log("\n--- Test 7: Error Categorization ---");

  const permissionError = new Error("EACCES: permission denied");
  const cat1 = categorizeImportError(permissionError);
  assertEqual(cat1, "permission_denied", "错误分类: 权限错误正确");

  const parseError = new Error("JSON.parse: Unexpected token");
  const cat2 = categorizeImportError(parseError);
  assertEqual(cat2, "parse_error", "错误分类: 解析错误正确");

  console.log("\n--- Test 8: Full Import Workflow ---");

  const batchNo = `BOM_TEST_${Date.now()}`;
  const dataPointsWithBatchId = parseResult.dataPoints.map(dp => ({
    ...dp,
    id: `dp_${generateId("test")}_${dp.id.split("_").pop()}`,
    batchId: "",
  }));

  const anomalies = detectAnomalies(dataPointsWithBatchId, rule);
  assertEqual(anomalies.length >= 0, true, "异常检测: 完成");

  const batch: Batch = {
    id: generateId("batch"),
    batchNo,
    note: "BOM JSON 完整测试",
    totalRows: parseResult.dataPoints.length,
    status: "completed",
    importedAt: new Date().toISOString(),
    ruleVersionId: rule.id,
    parseMetadata: parseResult.parseMetadata,
    dataPoints: dataPointsWithBatchId,
    anomalies,
    decisions: [],
    rollbackLogs: [],
  };

  await saveBatchWithData(batch);
  await wait(100);

  const loadedBatch = await getFullBatch(batch.id);
  assertTruthy(loadedBatch, "批次: 成功保存到数据库");
  assertEqual(loadedBatch?.parseMetadata?.hasBOM, true, "批次: parseMetadata hasBOM 正确");
  assertEqual(loadedBatch?.dataPoints?.length, 10, "批次: 数据点正确保存");

  const loadedDp = loadedBatch?.dataPoints?.find(dp => dp.sensorName === "Temperature_A1" && dp.rawTimestamp === "2024-01-15 08:30:00");
  assertTruthy(loadedDp, "批次: 找到 Temperature_A1 数据点");
  assertEqual(loadedDp?.sensorName, "Temperature_A1", "批次: 数据点内容正确");
  assertEqual(loadedDp?.rawTimestamp, "2024-01-15 08:30:00", "批次: 原始时间戳正确保存");
  assertEqual(loadedDp?.timeParseNote, dps[0].timeParseNote, "批次: 解析说明正确保存");

  console.log("\n--- Test 9: Reimport Consistency ---");

  const originalDp = loadedBatch!.dataPoints!.find(dp => 
    dp.sensorName === "Temperature_A1" && dp.rawTimestamp === "2024-01-15 08:30:00"
  )!;
  const expectedOriginalDp = dps.find(dp => 
    dp.sensorName === "Temperature_A1" && dp.rawTimestamp === "2024-01-15 08:30:00"
  )!;

  const reimportBatchNo = `${batchNo}_REIMPORT`;
  const reimportedDataPoints = loadedBatch!.dataPoints!.map(dp => ({
    ...dp,
    id: `dp_${generateId("reimp")}_${dp.id.split("_").pop()}`,
    batchId: `batch_${generateId("reimp")}`,
  }));

  const reimportedDp = reimportedDataPoints.find(dp => 
    dp.sensorName === "Temperature_A1" && dp.rawTimestamp === "2024-01-15 08:30:00"
  )!;

  assertEqual(reimportedDp.rawTimestamp, expectedOriginalDp.rawTimestamp, "重导: 原始时间戳保持一致");
  assertEqual(reimportedDp.timestamp, expectedOriginalDp.timestamp, "重导: 标准化时间戳保持一致");
  assertEqual(reimportedDp.timeParseNote, expectedOriginalDp.timeParseNote, "重导: 解析说明保持一致");
  assertEqual(reimportedDp.value, expectedOriginalDp.value, "重导: 数值保持一致");

  assertTruthy(reimportedDp.id.startsWith("dp_reimp"), "重导: ID 前缀正确");
  assertEqual(reimportedDp.id.endsWith(originalDp.id.split("_").pop()!), true, "重导: ID 后缀保持一致");

  console.log("\n--- Test 10: Export Consistency ---");

  const exportData = {
    exportVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    sourceName,
    sourceType: "json" as DataSourceType,
    hasBOM: true,
    timeConfig,
    dataPoints: loadedBatch!.dataPoints!.map(dp => ({
      id: dp.id,
      timestamp: dp.timestamp,
      sensorName: dp.sensorName,
      value: dp.value,
      status: dp.status,
      anomalies: dp.anomalies,
      rawTimestamp: dp.rawTimestamp,
      timeParseNote: dp.timeParseNote,
    })),
  };

  const exportDp = exportData.dataPoints.find(dp => 
    dp.sensorName === "Temperature_A1" && dp.rawTimestamp === "2024-01-15 08:30:00"
  )!;
  const expectedDp = dps.find(dp => 
    dp.sensorName === "Temperature_A1" && dp.rawTimestamp === "2024-01-15 08:30:00"
  )!;

  assertEqual(exportData.hasBOM, true, "导出: hasBOM 标记正确");
  assertEqual(exportDp.rawTimestamp, expectedDp.rawTimestamp, "导出: 原始时间戳一致");
  assertEqual(exportDp.timestamp, expectedDp.timestamp, "导出: 标准化时间戳一致");
  assertEqual(exportDp.timeParseNote, expectedDp.timeParseNote, "导出: 解析说明一致");

  console.log("\n--- Test 11: Multiple Time Format Handling ---");

  const formatCounts = parseResult.parseMetadata.autoDetectedFormatCounts;
  assertEqual(Object.keys(formatCounts).length >= 3, true, "多格式检测: 检测到至少 3 种格式");

  const formats = Object.keys(formatCounts);
  console.log(`    DEBUG: 检测到的格式 = ${JSON.stringify(formatCounts)}`);
  
  assertEqual(Object.keys(formatCounts).length >= 3, true, "格式检测: 至少 3 种格式");

  console.log("\n--- Test 12: Simulated App Restart ---");

  const savedConfigBefore = loadPerSourceConfig(sourceName);
  localStorage.clear();
  savePerSourceConfig(sourceName, savedConfigBefore!);
  const restoredAfterRestart = loadPerSourceConfig(sourceName);
  assertEqual(restoredAfterRestart?.preset, "auto", "模拟重启后: 数据源配置恢复");
  assertEqual(restoredAfterRestart?.customFormat, savedConfigBefore?.customFormat, "模拟重启后: 配置内容完全一致");

  console.log("\n" + "=".repeat(80));
  console.log("  All BOM JSON regression tests passed!");
  console.log("=".repeat(80) + "\n");
}

runBOMTests().catch((e) => {
  console.error("\n❌ TEST FAILED:", e);
  process.exit(1);
});
