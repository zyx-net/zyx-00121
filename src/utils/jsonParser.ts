import type {
  RuleVersion,
  TimeParseConfig,
  TimeParseConflictLog,
  ImportParseMetadata,
  ImportValidationResult,
  ImportError,
  DataPoint,
  FieldMappingInfo,
} from "@/types";
import { detectTimeFormat, parseTimestampWithFormat, loadTimeParseConfig } from "@/utils/csvParser";
import { generateSourceId } from "@/utils/perSourceTimeConfig";
import { generateId } from "@/utils/statistics";
import { detectAndStripBOM, readFileWithBOMHandling } from "@/utils/bomUtils";

const TIMESTAMP_ALIASES = ["timestamp", "time", "ts"];
const SENSOR_ALIASES = ["sensor", "sensorName"];
const VALUE_ALIASES = ["value", "val", "reading"];

function extractArray(parsed: unknown): Array<Record<string, unknown>> | null {
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

export async function parseJSONFile(
  file: File,
  ruleVersion: RuleVersion,
  timeConfig?: TimeParseConfig
): Promise<ImportValidationResult> {
  const config = timeConfig || loadTimeParseConfig();
  const sourceHash = generateSourceId(file.name);

  try {
    const { text, hasBOM } = await readFileWithBOMHandling(file);
    const warnings: string[] = [];
    if (hasBOM) {
      warnings.push("检测到 UTF-8 BOM（Windows 常见格式），已自动处理");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return {
        valid: false,
        errors: [
          {
            row: 0,
            column: "file",
            message: `JSON 解析失败: ${(e as Error).message}`,
            type: "invalid_value",
          },
        ],
        warnings,
        dataPoints: [],
        rowCount: 0,
        parseMetadata: {
          timeConfig: config,
          conflicts: [],
          autoDetectedFormatCounts: {},
          parseErrors: [],
          importedAt: new Date().toISOString(),
          hasBOM,
          sourceName: file.name,
          sourceType: "json",
        },
      };
    }

    const rows = extractArray(parsed);
    if (!rows) {
      return {
        valid: false,
        errors: [
          {
            row: 0,
            column: "file",
            message: "JSON 结构不支持：需要对象数组、{ data: [...] } 或 { records: [...] }",
            type: "invalid_value",
          },
        ],
        warnings,
        dataPoints: [],
        rowCount: 0,
        parseMetadata: {
          timeConfig: config,
          conflicts: [],
          autoDetectedFormatCounts: {},
          parseErrors: [],
          importedAt: new Date().toISOString(),
          hasBOM,
          sourceName: file.name,
          sourceType: "json",
        },
      };
    }

    const result = processParsedRows(rows, ruleVersion, config, sourceHash);
    return {
      ...result,
      warnings: [...warnings, ...result.warnings],
      parseMetadata: {
        ...result.parseMetadata,
        hasBOM,
        sourceName: file.name,
        sourceType: "json",
      },
    };
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          row: 0,
          column: "file",
          message: `文件读取失败: ${(e as Error).message}`,
          type: "invalid_value",
        },
      ],
      warnings: [],
      dataPoints: [],
      rowCount: 0,
      parseMetadata: {
        timeConfig: config,
        conflicts: [],
        autoDetectedFormatCounts: {},
        parseErrors: [],
        importedAt: new Date().toISOString(),
        sourceName: file.name,
        sourceType: "json",
      },
    };
  }
}

export function parseJSONString(
  jsonStr: string,
  ruleVersion: RuleVersion,
  timeConfig?: TimeParseConfig,
  sourceHash?: string,
  sourceName?: string
): ImportValidationResult {
  const config = timeConfig || loadTimeParseConfig();
  const actualSourceHash = sourceHash || generateSourceId(sourceName || "json_string");
  const actualSourceName = sourceName || "json_string";

  const { text: cleanedStr, hasBOM } = detectAndStripBOM(jsonStr);
  const warnings: string[] = [];
  if (hasBOM) {
    warnings.push("检测到 UTF-8 BOM（Windows 常见格式），已自动处理");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedStr);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          row: 0,
          column: "file",
          message: `JSON 解析失败: ${(e as Error).message}`,
          type: "invalid_value",
        },
      ],
      warnings,
      dataPoints: [],
      rowCount: 0,
      parseMetadata: {
        timeConfig: config,
        conflicts: [],
        autoDetectedFormatCounts: {},
        parseErrors: [],
        importedAt: new Date().toISOString(),
        hasBOM,
        sourceName: actualSourceName,
        sourceType: "json",
      },
    };
  }

  const rows = extractArray(parsed);
  if (!rows) {
    return {
      valid: false,
      errors: [
        {
          row: 0,
          column: "file",
          message: "JSON 结构不支持：需要对象数组、{ data: [...] } 或 { records: [...] }",
          type: "invalid_value",
        },
      ],
      warnings,
      dataPoints: [],
      rowCount: 0,
      parseMetadata: {
        timeConfig: config,
        conflicts: [],
        autoDetectedFormatCounts: {},
        parseErrors: [],
        importedAt: new Date().toISOString(),
        hasBOM,
        sourceName: actualSourceName,
        sourceType: "json",
      },
    };
  }

  const result = processParsedRows(rows, ruleVersion, config, actualSourceHash);
  return {
    ...result,
    warnings: [...warnings, ...result.warnings],
    parseMetadata: {
      ...result.parseMetadata,
      hasBOM,
      sourceName: actualSourceName,
      sourceType: "json",
    },
  };
}

export function processParsedRows(
  rows: Array<Record<string, unknown>>,
  ruleVersion: RuleVersion,
  timeConfig: TimeParseConfig,
  sourceHash?: string
): ImportValidationResult {
  const hash = sourceHash || generateSourceId(JSON.stringify(rows[0] || {}));
  const errors: ImportError[] = [];
  const warnings: string[] = [];
  const dataPoints: DataPoint[] = [];
  const validSensorNames = new Set(
    ruleVersion.sensorRules.map((s) => s.sensorName)
  );
  const seenKeys = new Set<string>();
  let duplicateCount = 0;

  const conflicts: TimeParseConflictLog[] = [];
  const autoDetectedFormatCounts: Record<string, number> = {};
  const parseErrorsList: Array<{ row: number; rawValue: string; message: string }> = [];

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
      const msg = `无效的时间戳格式: "${tsRaw}"，使用配置: ${timeConfig.preset}${timeConfig.customFormat ? ` (${timeConfig.customFormat})` : ""}`;
      errors.push({
        row: rowNum,
        column: "timestamp",
        message: msg,
        type: "bad_timestamp",
      });
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
      errors.push({
        row: rowNum,
        column: "value",
        message: `无效的数值: "${valueRaw}"`,
        type: "invalid_value",
      });
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
      id: `dp_${hash}_${rowNum}`,
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
  return {
    valid: fatalErrors.length === 0,
    errors,
    warnings,
    dataPoints,
    rowCount: rows.length,
    parseMetadata: {
      timeConfig,
      conflicts,
      autoDetectedFormatCounts,
      parseErrors: parseErrorsList,
      importedAt: new Date().toISOString(),
    },
  };
}

export function detectFieldMapping(rows: Array<Record<string, unknown>>): FieldMappingInfo {
  const allFields = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => allFields.add(key));
  });

  const detectedFields = Array.from(allFields);
  const mappedFields: FieldMappingInfo["mappedFields"] = {
    timestamp: null,
    sensorName: null,
    value: null,
  };
  const unmappedFields: string[] = [];
  const missingFields: string[] = [];
  const suggestions: Record<string, string[]> = {};

  const fieldMapping: Record<string, Array<{ target: keyof FieldMappingInfo["mappedFields"]; aliases: string[] }>> = {
    timestamp: { target: "timestamp", aliases: TIMESTAMP_ALIASES },
    sensorName: { target: "sensorName", aliases: SENSOR_ALIASES },
    value: { target: "value", aliases: VALUE_ALIASES },
  } as never;

  const mappingEntries = [
    { target: "timestamp" as const, aliases: TIMESTAMP_ALIASES },
    { target: "sensorName" as const, aliases: SENSOR_ALIASES },
    { target: "value" as const, aliases: VALUE_ALIASES },
  ];

  const mappedFieldKeys = new Set<string>();

  for (const { target, aliases } of mappingEntries) {
    let found = false;
    for (const alias of aliases) {
      for (const field of detectedFields) {
        if (field.toLowerCase() === alias.toLowerCase() && !mappedFieldKeys.has(field)) {
          mappedFields[target] = field;
          mappedFieldKeys.add(field);
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      missingFields.push(target);
    }
  }

  for (const field of detectedFields) {
    if (!mappedFieldKeys.has(field)) {
      unmappedFields.push(field);
    }
  }

  const timestampSuggestions = ["timestamp", "time", "ts", "datetime", "date"];
  const sensorSuggestions = ["sensor", "sensorName", "sensor_name", "name", "device"];
  const valueSuggestions = ["value", "val", "reading", "measurement", "data", "num"];

  for (const field of unmappedFields) {
    const lower = field.toLowerCase();
    const matched: string[] = [];

    if (timestampSuggestions.some((s) => lower.includes(s) || s.includes(lower))) {
      matched.push("timestamp");
    }
    if (sensorSuggestions.some((s) => lower.includes(s) || s.includes(lower))) {
      matched.push("sensorName");
    }
    if (valueSuggestions.some((s) => lower.includes(s) || s.includes(lower))) {
      matched.push("value");
    }

    if (matched.length > 0) {
      suggestions[field] = matched;
    }
  }

  return {
    detectedFields,
    mappedFields,
    unmappedFields,
    missingFields,
    suggestions,
  };
}

export function generateSampleJSON(): string {
  const sensors = ["Temperature_A1", "Pressure_B2", "Vibration_C3"];
  const start = new Date("2024-01-15T08:00:00");
  const records: Array<{ timestamp: string; sensorName: string; value: number }> = [];
  const duplicateSensor = "Temperature_A1";
  const duplicateTs = new Date(start.getTime() + 168 * 30_000);

  for (let i = 0; i < 200; i++) {
    const ts = new Date(start.getTime() + i * 30_000);
    const sensor = sensors[i % sensors.length];

    let value: number;
    switch (sensor) {
      case "Temperature_A1":
        value = 65 + Math.sin(i / 10) * 8 + (Math.random() - 0.5) * 3;
        break;
      case "Pressure_B2":
        value = 2.4 + Math.cos(i / 15) * 0.4 + (Math.random() - 0.5) * 0.2;
        break;
      case "Vibration_C3":
        value = 0.8 + Math.sin(i / 5) * 0.3 + (Math.random() - 0.5) * 0.15;
        break;
      default:
        value = 0;
    }

    if (i === 45) value = 200;
    if (i === 88) value = 0.001;
    if (i === 120) continue;
    if (i === 155) value = 65 + 50;

    records.push({
      timestamp: ts.toISOString().replace("T", " ").slice(0, 19),
      sensorName: sensor,
      value: Number(value.toFixed(3)),
    });

    if (i === 168 && sensor === duplicateSensor) {
      records.push({
        timestamp: duplicateTs.toISOString().replace("T", " ").slice(0, 19),
        sensorName: duplicateSensor,
        value: Number((value + 0.01).toFixed(3)),
      });
    }
  }

  return JSON.stringify(records, null, 2);
}
