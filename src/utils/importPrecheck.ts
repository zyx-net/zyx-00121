import Papa from "papaparse";
import type {
  RuleVersion,
  TimeParseConfig,
  PrecheckResult,
  FieldMappingInfo,
  TimeParsePreviewItem,
  AnomalySummaryPreview,
  KeyColumnPreviewRow,
  DataSourceType,
  ImportValidationResult,
  TimeParseConflictLog,
  DataPoint,
  ImportError,
} from "@/types";
import { detectTimeFormat, parseTimestampWithFormat, loadTimeParseConfig } from "@/utils/csvParser";
import { detectFieldMapping, processParsedRows } from "@/utils/jsonParser";
import { generateSourceId, loadPerSourceConfig } from "@/utils/perSourceTimeConfig";
import { detectAnomalies } from "@/utils/anomalyDetector";
import { generateId } from "@/utils/statistics";
import { detectAndStripBOM, readFileWithBOMHandling } from "@/utils/bomUtils";

const TIMESTAMP_ALIASES = ["timestamp", "time", "ts"];
const SENSOR_ALIASES = ["sensor", "sensorName"];
const VALUE_ALIASES = ["value", "val", "reading"];

function resolveField(row: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === alias.toLowerCase()) {
        return row[key];
      }
    }
  }
  return undefined;
}

function extractJSONArray(parsed: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(parsed)) {
    return parsed.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Array<Record<string, unknown>>;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data.filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item)) as Array<Record<string, unknown>>;
    }
    if (Array.isArray(obj.records)) {
      return obj.records.filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item)) as Array<Record<string, unknown>>;
    }
  }
  return null;
}

export async function precheckCSV(
  file: File,
  ruleVersion: RuleVersion,
  timeConfig?: TimeParseConfig
): Promise<PrecheckResult> {
  const config = timeConfig || loadPerSourceConfig(file.name) || loadTimeParseConfig();

  let hasBOM = false;
  let text = "";
  try {
    const result = await readFileWithBOMHandling(file);
    hasBOM = result.hasBOM;
    text = result.text;
  } catch {
    return precheckFromRows([], "csv", file.name, ruleVersion, config);
  }

  const rows: Array<Record<string, unknown>> = await new Promise((resolve) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve(results.data as Array<Record<string, unknown>>);
      },
      error: () => {
        resolve([]);
      },
    });
  });

  const precheckResult = precheckFromRows(rows, "csv", file.name, ruleVersion, config);
  precheckResult.validationResult.parseMetadata.hasBOM = hasBOM;
  precheckResult.validationResult.parseMetadata.sourceName = file.name;
  precheckResult.validationResult.parseMetadata.sourceType = "csv";
  if (hasBOM) {
    precheckResult.validationResult.warnings = [
      "检测到 UTF-8 BOM（Windows 常见格式），已自动处理",
      ...precheckResult.validationResult.warnings,
    ];
  }
  return precheckResult;
}

export async function precheckJSON(
  file: File,
  ruleVersion: RuleVersion,
  timeConfig?: TimeParseConfig
): Promise<PrecheckResult> {
  const config = timeConfig || loadPerSourceConfig(file.name) || loadTimeParseConfig();

  let hasBOM = false;
  let text = "";
  try {
    const result = await readFileWithBOMHandling(file);
    hasBOM = result.hasBOM;
    text = result.text;
  } catch {
    return precheckFromRows([], "json", file.name, ruleVersion, config);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return precheckFromRows([], "json", file.name, ruleVersion, config);
  }
  const rows = extractJSONArray(parsed) || [];

  const precheckResult = precheckFromRows(rows, "json", file.name, ruleVersion, config);
  precheckResult.validationResult.parseMetadata.hasBOM = hasBOM;
  precheckResult.validationResult.parseMetadata.sourceName = file.name;
  precheckResult.validationResult.parseMetadata.sourceType = "json";
  if (hasBOM) {
    precheckResult.validationResult.warnings = [
      "检测到 UTF-8 BOM（Windows 常见格式），已自动处理",
      ...precheckResult.validationResult.warnings,
    ];
  }
  return precheckResult;
}

export function precheckFromRows(
  rows: Array<Record<string, unknown>>,
  sourceType: DataSourceType,
  sourceName: string,
  ruleVersion: RuleVersion,
  timeConfig?: TimeParseConfig
): PrecheckResult {
  const config = timeConfig || loadPerSourceConfig(sourceName) || loadTimeParseConfig();
  const sourceHash = generateSourceId(sourceName);

  const fieldMapping = detectFieldMapping(rows);

  const errors: ImportError[] = [];
  const warnings: string[] = [];
  const dataPoints: DataPoint[] = [];
  const validSensorNames = new Set(ruleVersion.sensorRules.map((s) => s.sensorName));
  const seenKeys = new Set<string>();
  let duplicateCount = 0;

  const conflicts: TimeParseConflictLog[] = [];
  const autoDetectedFormatCounts: Record<string, number> = {};
  const parseErrorsList: Array<{ row: number; rawValue: string; message: string }> = [];
  const previewRows: TimeParsePreviewItem[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;

    const tsRawVal = resolveField(row, TIMESTAMP_ALIASES);
    const tsRaw = String(tsRawVal ?? "");
    const sensorNameVal = resolveField(row, SENSOR_ALIASES);
    const sensorName = String(sensorNameVal ?? "");
    const valueRaw = resolveField(row, VALUE_ALIASES);

    const detectedFormat = detectTimeFormat(tsRaw);
    autoDetectedFormatCounts[detectedFormat] = (autoDetectedFormatCounts[detectedFormat] || 0) + 1;

    const autoParsed = parseTimestampWithFormat(tsRaw, "auto");
    const userParsed =
      config.preset !== "auto"
        ? parseTimestampWithFormat(tsRaw, config.preset, config.customFormat)
        : autoParsed;

    let finalTs: Date | null = null;
    let parseNote: string | undefined;
    let conflictReason: string | undefined;
    let isConflict = false;
    let finalFormatUsed = config.preset === "auto" ? detectedFormat : config.preset;

    if (config.preset !== "auto" && autoParsed && userParsed) {
      const autoIso = autoParsed.toISOString();
      const userIso = userParsed.toISOString();
      if (autoIso !== userIso) {
        isConflict = true;
        conflictReason = `自动识别格式(${detectedFormat})与手动配置(${config.preset})解析结果不一致`;
        finalTs = userParsed;
        parseNote = `使用手动配置(${config.preset})，自动识别(${detectedFormat})结果: ${autoIso}`;
        finalFormatUsed = config.preset;

        conflicts.push({
          id: generateId("tconflict"),
          rowNumber: rowNum,
          rawValue: tsRaw,
          autoDetectedFormat: detectedFormat,
          userSelectedFormat: config.preset,
          autoParsedTimestamp: autoIso,
          userParsedTimestamp: userIso,
          finalTimestamp: userIso,
          finalFormatUsed: config.preset,
          conflictReason,
          resolvedAt: new Date().toISOString(),
        });
      } else {
        finalTs = userParsed;
        finalFormatUsed = config.preset;
      }
    } else {
      finalTs = userParsed;
      if (config.preset === "auto") {
        finalFormatUsed = detectedFormat;
      }
    }

    previewRows.push({
      rowNumber: rowNum,
      rawValue: tsRaw,
      detectedFormat,
      parsedTimestamp: finalTs ? finalTs.toISOString() : null,
      isConflict,
      conflictReason,
      finalFormatUsed,
    });

    if (!finalTs) {
      const msg = `无效的时间戳格式: "${tsRaw}"，使用配置: ${config.preset}${config.customFormat ? ` (${config.customFormat})` : ""}`;
      errors.push({ row: rowNum, column: "timestamp", message: msg, type: "bad_timestamp" });
      parseErrorsList.push({ row: rowNum, rawValue: tsRaw, message: msg });
      return;
    }

    if (!sensorName || !validSensorNames.has(sensorName)) {
      errors.push({
        row: rowNum,
        column: "sensor",
        message: `未知传感器: "${sensorName}"，请先在规则中配置`,
        type: "unknown_sensor",
      });
      return;
    }

    const value = Number(valueRaw);
    if (isNaN(value)) {
      errors.push({ row: rowNum, column: "value", message: `无效的数值: "${valueRaw}"`, type: "invalid_value" });
      return;
    }

    const finalIso = finalTs.toISOString();
    const key = `${sensorName}__${finalIso}`;
    if (seenKeys.has(key)) {
      duplicateCount++;
      errors.push({
        row: rowNum,
        column: "timestamp",
        message: `传感器 ${sensorName} 在时间 ${tsRaw} 存在重复记录（将保留供异常检测）`,
        type: "duplicate",
      });
    } else {
      seenKeys.add(key);
    }

    dataPoints.push({
      id: `dp_${sourceHash}_${rowNum}`,
      timestamp: finalIso,
      rawTimestamp: tsRaw,
      sensorName,
      value,
      timeParseNote: parseNote,
    });
  });

  if (duplicateCount > 0) {
    warnings.push(`检测到 ${duplicateCount} 条重复时间戳记录，将在异常检测中标记`);
  }
  if (conflicts.length > 0) {
    warnings.push(`检测到 ${conflicts.length} 条时间解析冲突记录，已优先使用手动配置的格式`);
  }

  const fatalErrors = errors.filter((e) => e.type !== "duplicate");
  const validationResult: ImportValidationResult = {
    valid: fatalErrors.length === 0,
    errors,
    warnings,
    dataPoints,
    rowCount: rows.length,
    parseMetadata: {
      timeConfig: config,
      conflicts,
      autoDetectedFormatCounts,
      parseErrors: parseErrorsList,
      importedAt: new Date().toISOString(),
    },
  };

  const anomalies = detectAnomalies(dataPoints, ruleVersion);
  const anomalySummary: AnomalySummaryPreview = {
    totalAnomalies: anomalies.length,
    byType: {},
    bySensor: {},
  };
  for (const a of anomalies) {
    anomalySummary.byType[a.type] = (anomalySummary.byType[a.type] || 0) + 1;
    anomalySummary.bySensor[a.sensorName] = (anomalySummary.bySensor[a.sensorName] || 0) + 1;
  }

  const keyColumnsPreview: KeyColumnPreviewRow[] = dataPoints.slice(0, 20).map((dp, idx) => {
    const matchingPreview = previewRows.find((p) => p.rowNumber === idx + 2);
    return {
      rowNumber: idx + 2,
      rawTimestamp: dp.rawTimestamp,
      standardizedTimestamp: dp.timestamp,
      sensorName: dp.sensorName,
      value: dp.value,
      timeFormatUsed: matchingPreview?.finalFormatUsed || config.preset,
      parseNote: dp.timeParseNote,
    };
  });

  return {
    sourceType,
    sourceName,
    fieldMapping,
    timeParsePreview: {
      config,
      formatDistribution: autoDetectedFormatCounts,
      conflicts,
      previewRows,
      parseErrorCount: parseErrorsList.length,
    },
    anomalySummary,
    keyColumnsPreview,
    validationResult,
  };
}
