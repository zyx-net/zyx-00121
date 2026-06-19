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
  ImportValidationResult,
  PrecheckResult,
  FieldMappingInfo,
} from "../src/types";
import { db, saveBatchWithData, getFullBatch, saveReviewDecision } from "../src/db/database";
import { detectAnomalies } from "../src/utils/anomalyDetector";
import { computeStatistics, generateId, formatTimestamp } from "../src/utils/statistics";
import {
  generateSampleCSV,
  generateMixedFormatSampleCSV,
  processParsedData,
  parseTimestampWithFormat,
  detectTimeFormat,
} from "../src/utils/csvParser";
import {
  parseJSONString,
  processParsedRows,
  detectFieldMapping,
  generateSampleJSON,
} from "../src/utils/jsonParser";
import { precheckFromRows } from "../src/utils/importPrecheck";
import {
  generateSourceId,
  savePerSourceConfig,
  loadPerSourceConfig,
  listPerSourceConfigs,
  deletePerSourceConfig,
} from "../src/utils/perSourceTimeConfig";
import { exportReportCSV, exportTimeParseAuditLog } from "../src/utils/reportExporter";
import { collapseDecisions, getDecisionHistory } from "../src/utils/decisionHistory";

console.log("\n" + "=".repeat(80));
console.log("  Import Precheck Module - Full-Chain Regression Test Suite");
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
    name: "Import Precheck Test Rule",
    version: 1,
    createdAt: new Date().toISOString(),
    description: "Rule for import precheck regression tests",
    devices: [{ id: devId, name: "Test Production Line", code: "TEST-001" }],
    sensorRules: [
      {
        id: generateId("sr"),
        deviceId: devId,
        sensorName: "Temperature_A1",
        minValue: 40,
        maxValue: 100,
        jumpThreshold: 30,
        unit: "\u2103",
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

async function runImportPrecheckTests() {
  console.log("\nInitializing test environment (IndexedDB)");
  await db.delete();
  await db.open();

  const rule = createDefaultRule();
  await db.ruleVersions.put(rule);

  console.log("\nTest 1: JSON Parser - Basic Array Format");
  {
    const json = JSON.stringify([
      { timestamp: "2024-01-15 08:00:00", sensorName: "Temperature_A1", value: 65.5 },
      { timestamp: "2024-01-15 08:00:30", sensorName: "Pressure_B2", value: 2.4 },
      { timestamp: "2024-01-15 08:01:00", sensorName: "Vibration_C3", value: 0.9 },
    ]);
    const result = parseJSONString(json, rule, { preset: "auto" });
    assertEqual(result.dataPoints.length, 3, "Basic array format: 3 dataPoints created");
    assertEqual(result.dataPoints[0].sensorName, "Temperature_A1", "First dataPoint sensorName correct");
    assertEqual(result.dataPoints[1].value, 2.4, "Second dataPoint value correct");
    assertEqual(result.dataPoints[0].rawTimestamp, "2024-01-15 08:00:00", "rawTimestamp preserved");
    assertTruthy(result.dataPoints[0].timestamp !== undefined, "timestamp is populated");
  }

  console.log("\nTest 2: JSON Parser - Object with data array");
  {
    const json = JSON.stringify({
      data: [
        { timestamp: "2024-01-15 09:00:00", sensorName: "Temperature_A1", value: 70.0 },
        { timestamp: "2024-01-15 09:00:30", sensorName: "Pressure_B2", value: 3.1 },
      ],
    });
    const result = parseJSONString(json, rule, { preset: "auto" });
    assertEqual(result.dataPoints.length, 2, "Object with data array: 2 dataPoints created");
    assertEqual(result.dataPoints[0].value, 70.0, "First dataPoint value correct");
    assertEqual(result.dataPoints[1].sensorName, "Pressure_B2", "Second dataPoint sensorName correct");
  }

  console.log("\nTest 3: JSON Parser - Object with records array");
  {
    const json = JSON.stringify({
      records: [
        { timestamp: "2024-01-15 10:00:00", sensorName: "Vibration_C3", value: 1.2 },
      ],
    });
    const result = parseJSONString(json, rule, { preset: "auto" });
    assertEqual(result.dataPoints.length, 1, "Object with records array: 1 dataPoint created");
    assertEqual(result.dataPoints[0].sensorName, "Vibration_C3", "dataPoint sensorName correct");
    assertEqual(result.dataPoints[0].value, 1.2, "dataPoint value correct");
  }

  console.log("\nTest 4: JSON Parser - Invalid JSON handling");
  {
    const invalidJson = "{ this is not valid json }}}";
    const result = parseJSONString(invalidJson, rule, { preset: "auto" });
    assertEqual(result.valid, false, "Invalid JSON returns valid=false");
    assertTruthy(result.errors.length > 0, "Invalid JSON returns errors");
    assertContains(result.errors[0].message, "JSON", "Error message mentions JSON parse failure");
  }

  console.log("\nTest 5: Field Mapping Detection");
  {
    const standardRows = [
      { timestamp: "2024-01-15 08:00:00", sensorName: "Temperature_A1", value: 65 },
    ];
    const standardMapping = detectFieldMapping(standardRows);
    assertEqual(standardMapping.mappedFields.timestamp, "timestamp", "Standard timestamp field mapped");
    assertEqual(standardMapping.mappedFields.sensorName, "sensorName", "Standard sensorName field mapped");
    assertEqual(standardMapping.mappedFields.value, "value", "Standard value field mapped");
    assertEqual(standardMapping.missingFields.length, 0, "No missing fields for standard input");

    const aliasRows = [
      { time: "2024-01-15 08:00:00", sensor: "Temperature_A1", val: 65 },
    ];
    const aliasMapping = detectFieldMapping(aliasRows);
    assertEqual(aliasMapping.mappedFields.timestamp, "time", "Alias 'time' mapped to timestamp");
    assertEqual(aliasMapping.mappedFields.sensorName, "sensor", "Alias 'sensor' mapped to sensorName");
    assertEqual(aliasMapping.mappedFields.value, "val", "Alias 'val' mapped to value");

    const readingRows = [
      { ts: "2024-01-15 08:00:00", sensorName: "Temperature_A1", reading: 65 },
    ];
    const readingMapping = detectFieldMapping(readingRows);
    assertEqual(readingMapping.mappedFields.timestamp, "ts", "Alias 'ts' mapped to timestamp");
    assertEqual(readingMapping.mappedFields.value, "reading", "Alias 'reading' mapped to value");

    const extraRows = [
      { timestamp: "2024-01-15 08:00:00", sensorName: "Temperature_A1", value: 65, extra_col: "hello" },
    ];
    const extraMapping = detectFieldMapping(extraRows);
    assertTruthy(extraMapping.unmappedFields.includes("extra_col"), "Unmapped field 'extra_col' detected");

    const missingRows = [
      { timestamp: "2024-01-15 08:00:00" },
    ];
    const missingMapping = detectFieldMapping(missingRows);
    assertTruthy(missingMapping.missingFields.length > 0, "Missing fields detected for incomplete rows");
  }

  console.log("\nTest 6: Per-Source Time Config Persistence");
  {
    const sourceName = "test_sensor_data.csv";
    const config: TimeParseConfig = { preset: "unix_seconds" };
    savePerSourceConfig(sourceName, config);

    const loaded = loadPerSourceConfig(sourceName);
    assertEqual(loaded.preset, "unix_seconds", "Per-source config loaded with correct preset");

    const allConfigs = listPerSourceConfigs();
    assertTruthy(allConfigs.length >= 1, "listPerSourceConfigs returns at least 1 entry");
    const found = allConfigs.find(c => c.sourceName === sourceName);
    assertTruthy(found !== undefined, "Saved config found in list");
    assertEqual(found!.config.preset, "unix_seconds", "Listed config has correct preset");

    deletePerSourceConfig(sourceName);
    const afterDelete = loadPerSourceConfig(sourceName);
    assertEqual(afterDelete.preset, "auto", "After delete, falls back to global default 'auto'");

    const customConfig: TimeParseConfig = { preset: "custom", customFormat: "YYYY/MM/DD HH:mm:ss" };
    savePerSourceConfig(sourceName, customConfig);
    const loadedCustom = loadPerSourceConfig(sourceName);
    assertEqual(loadedCustom.preset, "custom", "Custom preset loaded");
    assertEqual(loadedCustom.customFormat, "YYYY/MM/DD HH:mm:ss", "Custom format string loaded");
  }

  console.log("\nTest 7: Per-Source Time Config - Restart Recovery");
  {
    const sourceName = "restart_test.csv";
    const config: TimeParseConfig = { preset: "unix_milliseconds" };
    savePerSourceConfig(sourceName, config);

    const firstLoad = loadPerSourceConfig(sourceName);
    assertEqual(firstLoad.preset, "unix_milliseconds", "Config saved correctly before restart simulation");

    const originalStore = (global.localStorage as LocalStorageMock);
    const storedKeys: Record<string, string> = {};
    for (let i = 0; i < originalStore.length; i++) {
      const key = originalStore.key(i);
      if (key) {
        const val = originalStore.getItem(key);
        if (val) storedKeys[key] = val;
      }
    }

    const newStore = new LocalStorageMock();
    Object.entries(storedKeys).forEach(([k, v]) => newStore.setItem(k, v));
    global.localStorage = newStore;

    const afterRestart = loadPerSourceConfig(sourceName);
    assertEqual(afterRestart.preset, "unix_milliseconds", "Config persists after restart simulation");

    global.localStorage = originalStore;
  }

  console.log("\nTest 8: Precheck - CSV Data");
  {
    const csv = generateSampleCSV();
    const rows = parseCSVString(csv);
    const typedRows: Array<Record<string, unknown>> = rows.map(r => {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        obj[k] = v;
      }
      return obj;
    });
    const result = precheckFromRows(typedRows, "csv", "test.csv", rule, { preset: "auto" });

    assertTruthy(result.fieldMapping !== undefined, "fieldMapping is populated");
    assertTruthy(result.fieldMapping.mappedFields.timestamp !== null, "timestamp field mapped in precheck");

    assertTruthy(result.timeParsePreview !== undefined, "timeParsePreview is populated");
    assertTruthy(result.timeParsePreview.formatDistribution !== undefined, "formatDistribution is populated");
    assertTruthy(Object.keys(result.timeParsePreview.formatDistribution).length > 0, "formatDistribution has entries");

    assertTruthy(result.anomalySummary !== undefined, "anomalySummary is populated");
    assertTruthy(result.anomalySummary.byType !== undefined, "anomalySummary.byType is populated");
    assertTruthy(result.anomalySummary.bySensor !== undefined, "anomalySummary.bySensor is populated");

    assertTruthy(result.keyColumnsPreview.length > 0, "keyColumnsPreview has data");

    assertTruthy(result.validationResult !== undefined, "validationResult is populated");
  }

  console.log("\nTest 9: Precheck - JSON Data");
  {
    const jsonStr = generateSampleJSON();
    const parsed = JSON.parse(jsonStr);
    const rows = Array.isArray(parsed) ? parsed : [];
    const result = precheckFromRows(rows, "json", "test.json", rule, { preset: "auto" });

    assertTruthy(result.fieldMapping !== undefined, "JSON precheck: fieldMapping populated");
    assertTruthy(result.timeParsePreview.formatDistribution !== undefined, "JSON precheck: formatDistribution populated");
    assertTruthy(result.anomalySummary !== undefined, "JSON precheck: anomalySummary populated");
    assertTruthy(result.keyColumnsPreview.length > 0, "JSON precheck: keyColumnsPreview has data");
    assertTruthy(result.validationResult !== undefined, "JSON precheck: validationResult populated");
    assertTruthy(result.validationResult.dataPoints.length > 0, "JSON precheck: dataPoints created");
  }

  console.log("\nTest 10: Precheck - Time Parse Conflicts");
  {
    const mixedCSV = generateMixedFormatSampleCSV();
    const rows = parseCSVString(mixedCSV);
    const typedRows: Array<Record<string, unknown>> = rows.map(r => {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        obj[k] = v;
      }
      return obj;
    });
    const result = precheckFromRows(typedRows, "csv", "mixed.csv", rule, { preset: "unix_seconds" });

    assertTruthy(result.timeParsePreview.conflicts.length > 0, "Conflicts detected with unix_seconds preset");

    const firstConflict = result.timeParsePreview.conflicts[0];
    assertTruthy(firstConflict.rowNumber !== undefined, "Conflict has rowNumber");
    assertTruthy(firstConflict.rawValue !== undefined, "Conflict has rawValue");
    assertTruthy(firstConflict.autoDetectedFormat !== undefined, "Conflict has autoDetectedFormat");
    assertTruthy(firstConflict.userSelectedFormat !== undefined, "Conflict has userSelectedFormat");
    assertTruthy(firstConflict.autoParsedTimestamp !== null, "Conflict has autoParsedTimestamp");
    assertTruthy(firstConflict.userParsedTimestamp !== null, "Conflict has userParsedTimestamp");
    assertTruthy(firstConflict.finalTimestamp !== null, "Conflict has finalTimestamp");
    assertTruthy(firstConflict.finalFormatUsed !== undefined, "Conflict has finalFormatUsed");
    assertTruthy(firstConflict.conflictReason !== undefined, "Conflict has conflictReason");
    assertEqual(firstConflict.userSelectedFormat, "unix_seconds", "User selected format is unix_seconds");
    assertContains(firstConflict.conflictReason, "unix_seconds", "Conflict reason explains the manual format");
  }

  console.log("\nTest 11: Deterministic IDs");
  {
    const jsonStr = generateSampleJSON();
    const parsed = JSON.parse(jsonStr);
    const rows: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [];
    const sourceHash = generateSourceId("deterministic_test.json");
    const config: TimeParseConfig = { preset: "auto" };

    const firstRun = processParsedRows(rows, rule, config, sourceHash);
    const secondRun = processParsedRows(rows, rule, config, sourceHash);

    assertEqual(firstRun.dataPoints.length, secondRun.dataPoints.length, "Same dataPoint count across runs");

    for (let i = 0; i < Math.min(10, firstRun.dataPoints.length); i++) {
      assertEqual(firstRun.dataPoints[i].id, secondRun.dataPoints[i].id, `DataPoint ${i} ID is identical`);
      assertEqual(firstRun.dataPoints[i].timestamp, secondRun.dataPoints[i].timestamp, `DataPoint ${i} timestamp is identical`);
      assertEqual(firstRun.dataPoints[i].sensorName, secondRun.dataPoints[i].sensorName, `DataPoint ${i} sensorName is identical`);
      assertEqual(firstRun.dataPoints[i].value, secondRun.dataPoints[i].value, `DataPoint ${i} value is identical`);
    }
  }

  console.log("\nTest 12: Full Chain - CSV Import -> Anomaly Detection -> Review -> Export -> Restart Recovery");
  {
    const csv = generateSampleCSV();
    const rows = parseCSVString(csv);
    const csvRows: Array<Record<string, string>> = rows;
    const config: TimeParseConfig = { preset: "auto" };
    const sourceHash = generateSourceId("full_chain_test.csv");

    const parseErrors: Array<{ row: number; message: string; code?: string }> = [];
    const result = processParsedData(csvRows, rule, parseErrors, config, sourceHash);
    assertTruthy(result.dataPoints.length > 0, "CSV import produced dataPoints");

    const anomalies = detectAnomalies(result.dataPoints, rule);
    assertTruthy(anomalies.length > 0, "Anomaly detection found anomalies");

    const batchNo = `TEST-PRECHECK-CSV-${Date.now()}`;
    const batch: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "Full chain CSV test batch",
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
    assertTruthy(savedBatch !== undefined, "Batch saved to IndexedDB");

    if (anomalies.length > 0) {
      await saveReviewDecision(batch.id, {
        id: generateId("dec"),
        anomalyId: anomalies[0].id,
        label: "confirmed_fault",
        reviewedAt: new Date().toISOString(),
        comment: "Test review decision",
      });
      await wait(50);
    }

    const reviewedBatch = await getFullBatch(batch.id);
    const stats = computeStatistics(reviewedBatch!.anomalies, reviewedBatch!.decisions);
    const report = exportReportCSV(reviewedBatch!, rule, stats);

    assertContains(report, "\u539F\u59CB\u65F6\u95F4\u6233", "Export report contains original timestamps");
    assertContains(report, "\u6807\u51C6\u5316\u65F6\u95F4", "Export report contains standardized times");
    assertContains(report, "\u65F6\u95F4\u683C\u5F0F\u8BF4\u660E", "Export report contains time format info");

    await db.close();
    await wait(200);
    await db.open();

    const afterRestart = await getFullBatch(batch.id);
    assertTruthy(afterRestart !== undefined, "Batch exists after restart");
    assertEqual(afterRestart!.dataPoints.length, batch.dataPoints.length, "DataPoint count preserved after restart");
    assertEqual(afterRestart!.anomalies.length, anomalies.length, "Anomaly count preserved after restart");

    const afterRestartStats = computeStatistics(afterRestart!.anomalies, afterRestart!.decisions);
    assertEqual(afterRestartStats.totalAnomalies, stats.totalAnomalies, "Statistics identical after restart");
    assertEqual(afterRestartStats.byLabel.confirmed_fault, stats.byLabel.confirmed_fault, "Confirmed fault count identical after restart");
  }

  console.log("\nTest 13: Full Chain - JSON Import -> Anomaly Detection -> Review -> Export -> Restart Recovery");
  {
    const jsonStr = generateSampleJSON();
    const parsed = JSON.parse(jsonStr);
    const rows: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [];
    const config: TimeParseConfig = { preset: "auto" };
    const sourceHash = generateSourceId("full_chain_test.json");

    const result = processParsedRows(rows, rule, config, sourceHash);
    assertTruthy(result.dataPoints.length > 0, "JSON import produced dataPoints");

    const anomalies = detectAnomalies(result.dataPoints, rule);
    assertTruthy(anomalies.length > 0, "Anomaly detection found anomalies from JSON data");

    const batchNo = `TEST-PRECHECK-JSON-${Date.now()}`;
    const batch: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "Full chain JSON test batch",
      totalRows: result.dataPoints.length,
      status: "reviewing",
      dataPoints: result.dataPoints,
      anomalies,
      decisions: [],
      rollbackLogs: [],
      parseMetadata: result.parseMetadata,
    };

    await saveBatchWithData(batch);

    if (anomalies.length > 0) {
      await saveReviewDecision(batch.id, {
        id: generateId("dec"),
        anomalyId: anomalies[0].id,
        label: "false_positive",
        reviewedAt: new Date().toISOString(),
        comment: "JSON test review",
      });
      await wait(50);
    }

    const reviewedBatch = await getFullBatch(batch.id);
    const stats = computeStatistics(reviewedBatch!.anomalies, reviewedBatch!.decisions);
    const report = exportReportCSV(reviewedBatch!, rule, stats);

    assertContains(report, "\u539F\u59CB\u65F6\u95F4\u6233", "JSON export report contains original timestamps");
    assertContains(report, "\u6807\u51C6\u5316\u65F6\u95F4", "JSON export report contains standardized times");
    assertContains(report, "\u4F20\u611F\u5668\u540D\u79F0", "JSON export report contains sensor names");

    await db.close();
    await wait(200);
    await db.open();

    const afterRestart = await getFullBatch(batch.id);
    assertTruthy(afterRestart !== undefined, "JSON batch exists after restart");
    assertEqual(afterRestart!.dataPoints.length, batch.dataPoints.length, "JSON dataPoint count preserved after restart");
    assertEqual(afterRestart!.anomalies.length, anomalies.length, "JSON anomaly count preserved after restart");
  }

  console.log("\nTest 14: Deterministic Re-import (Undo and Re-import)");
  {
    const jsonStr = generateSampleJSON();
    const parsed = JSON.parse(jsonStr);
    const rows: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [];
    const config: TimeParseConfig = { preset: "auto" };
    const sourceHash = generateSourceId("reimport_test.json");

    const firstResult = processParsedRows(rows, rule, config, sourceHash);
    const anomalies1 = detectAnomalies(firstResult.dataPoints, rule);

    const batchNo = `TEST-REIMPORT-${Date.now()}`;
    const batch1: Batch = {
      id: generateId("batch"),
      batchNo,
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "Deterministic re-import test - first",
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
    assertTruthy(savedConfig !== undefined, "Saved config available for re-import");

    const secondResult = processParsedRows(rows, rule, savedConfig!, sourceHash);
    const anomalies2 = detectAnomalies(secondResult.dataPoints, rule);

    assertEqual(secondResult.dataPoints.length, firstResult.dataPoints.length, "Re-import produces same dataPoint count");

    for (let i = 0; i < Math.min(10, firstResult.dataPoints.length); i++) {
      assertEqual(secondResult.dataPoints[i].timestamp, firstResult.dataPoints[i].timestamp, `Re-import dataPoint ${i} timestamp matches`);
      assertEqual(secondResult.dataPoints[i].sensorName, firstResult.dataPoints[i].sensorName, `Re-import dataPoint ${i} sensorName matches`);
      assertEqual(secondResult.dataPoints[i].value, firstResult.dataPoints[i].value, `Re-import dataPoint ${i} value matches`);
      assertEqual(secondResult.dataPoints[i].rawTimestamp, firstResult.dataPoints[i].rawTimestamp, `Re-import dataPoint ${i} rawTimestamp matches`);
    }

    assertEqual(anomalies2.length, anomalies1.length, "Re-import anomaly count matches");
    assertEqual(secondResult.parseMetadata.conflicts.length, firstResult.parseMetadata.conflicts.length, "Re-import conflict count matches");
  }

  console.log("\nTest 15: Sample Data Generation");
  {
    const jsonStr = generateSampleJSON();
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error("generateSampleJSON() returned invalid JSON");
    }
    assertTruthy(Array.isArray(parsed), "generateSampleJSON returns a JSON array");

    const jsonArray = parsed as Array<Record<string, unknown>>;
    assertTruthy(jsonArray.length > 0, "JSON sample data has records");

    const firstRecord = jsonArray[0];
    assertTruthy("timestamp" in firstRecord, "JSON record has timestamp field");
    assertTruthy("sensorName" in firstRecord, "JSON record has sensorName field");
    assertTruthy("value" in firstRecord, "JSON record has value field");

    const csv = generateSampleCSV();
    const csvLines = csv.trim().split("\n");
    assertTruthy(csvLines.length > 1, "generateSampleCSV returns multi-line CSV");
    assertContains(csvLines[0], "timestamp", "CSV header contains timestamp");
    assertContains(csvLines[0], "sensorName", "CSV header contains sensorName");
    assertContains(csvLines[0], "value", "CSV header contains value");
  }

  console.log("\n" + "=".repeat(80));
  console.log("ALL Import Precheck Regression Tests PASSED!");
  console.log("=".repeat(80));
  console.log("\nVerified scenarios:");
  console.log("   1. JSON Parser - Basic Array Format");
  console.log("   2. JSON Parser - Object with data array");
  console.log("   3. JSON Parser - Object with records array");
  console.log("   4. JSON Parser - Invalid JSON handling");
  console.log("   5. Field Mapping Detection (standard, aliases, unmapped, missing)");
  console.log("   6. Per-Source Time Config Persistence (save, load, list, delete, fallback)");
  console.log("   7. Per-Source Time Config - Restart Recovery");
  console.log("   8. Precheck - CSV Data (fieldMapping, timeParsePreview, anomalySummary, keyColumnsPreview, validationResult)");
  console.log("   9. Precheck - JSON Data (all precheck fields populated)");
  console.log("   10. Precheck - Time Parse Conflicts (conflict fields verified)");
  console.log("   11. Deterministic IDs (same sourceHash = same IDs)");
  console.log("   12. Full Chain - CSV Import -> Anomaly -> Review -> Export -> Restart Recovery");
  console.log("   13. Full Chain - JSON Import -> Anomaly -> Review -> Export -> Restart Recovery");
  console.log("   14. Deterministic Re-import (Undo and Re-import)");
  console.log("   15. Sample Data Generation (JSON + CSV backward compatibility)");
  console.log("\n");
}

runImportPrecheckTests().catch(err => {
  console.error("\nFAILED: Import Precheck Regression Test:", err);
  process.exit(1);
});
