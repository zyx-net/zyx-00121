import Papa from "papaparse";
import type {
  DataPoint,
  ImportValidationResult,
  ImportError,
  RuleVersion,
  TimeParseConfig,
  TimeParseConflictLog,
  TimeFormatPreset,
  ImportParseMetadata,
} from "@/types";
import { generateId } from "@/utils/statistics";

export const TIME_FORMAT_PRESETS: Array<{ value: TimeFormatPreset; label: string; description: string }> = [
  { value: "auto", label: "自动识别", description: "智能检测时间格式" },
  { value: "unix_seconds", label: "Unix 时间戳（秒）", description: "10 位数字，如 1704067200" },
  { value: "unix_milliseconds", label: "Unix 时间戳（毫秒）", description: "13 位数字，如 1704067200000" },
  { value: "custom", label: "自定义格式", description: "手动指定格式字符串" },
];

export const TIME_PARSE_CONFIG_KEY = "sensor_qa_time_parse_config";

export function loadTimeParseConfig(): TimeParseConfig {
  try {
    const saved = localStorage.getItem(TIME_PARSE_CONFIG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        preset: parsed.preset || "auto",
        customFormat: parsed.customFormat,
        columnName: parsed.columnName,
      };
    }
  } catch (e) {
    // ignore
  }
  return { preset: "auto" };
}

export function saveTimeParseConfig(config: TimeParseConfig): void {
  localStorage.setItem(TIME_PARSE_CONFIG_KEY, JSON.stringify(config));
}

export function detectTimeFormat(raw: string): string {
  if (typeof raw !== "string") return "unknown";
  const trimmed = raw.trim();
  if (!trimmed) return "empty";

  if (/^\d{10}$/.test(trimmed)) return "unix_seconds";
  if (/^\d{13}$/.test(trimmed)) return "unix_milliseconds";
  if (/^\d{10}\.\d+$/.test(trimmed)) return "unix_seconds_decimal";

  const isoPattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
  if (isoPattern.test(trimmed)) return "iso_standard";

  const cnDatePattern = /^\d{4}\/\d{2}\/\d{2}[ ]\d{2}:\d{2}:\d{2}/;
  if (cnDatePattern.test(trimmed)) return "cn_slash_format";

  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (dateOnlyPattern.test(trimmed)) return "date_only";

  const compactPattern = /^\d{4}\d{2}\d{2}_\d{2}\d{2}\d{2}/;
  if (compactPattern.test(trimmed)) return "compact_format";

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return "js_date_parseable";

  return "unknown";
}

export function parseTimestampWithFormat(raw: string, preset: TimeFormatPreset, customFormat?: string): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  switch (preset) {
    case "unix_seconds": {
      const num = Number(trimmed);
      if (!isNaN(num) && /^\d+(\.\d+)?$/.test(trimmed)) {
        const d = new Date(num * 1000);
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    }
    case "unix_milliseconds": {
      const num = Number(trimmed);
      if (!isNaN(num) && /^\d+$/.test(trimmed)) {
        const d = new Date(num);
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    }
    case "custom": {
      return parseCustomFormat(trimmed, customFormat);
    }
    case "auto":
    default:
      return parseTimestampAuto(trimmed);
  }
}

function parseTimestampAuto(trimmed: string): Date | null {
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  const formats = [
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,
    /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ];

  for (const fmt of formats) {
    const m = trimmed.match(fmt);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      const parsed = new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h || 0),
        Number(mi || 0),
        Number(s || 0)
      );
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  if (/^\d{10}$/.test(trimmed)) {
    const d = new Date(Number(trimmed) * 1000);
    if (!isNaN(d.getTime())) return d;
  }

  if (/^\d{13}$/.test(trimmed)) {
    const d = new Date(Number(trimmed));
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function parseCustomFormat(trimmed: string, customFormat?: string): Date | null {
  if (!customFormat) return null;

  const formatPatterns: Record<string, RegExp> = {
    "YYYY-MM-DD HH:mm:ss": /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    "YYYY/MM/DD HH:mm:ss": /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    "YYYY-MM-DDTHH:mm:ss": /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,
    "YYYYMMDD_HHmmss": /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/,
    "YYYY-MM-DD": /^(\d{4})-(\d{2})-(\d{2})$/,
    "DD-MM-YYYY HH:mm:ss": /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
    "MM/DD/YYYY HH:mm:ss": /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
  };

  const fmt = formatPatterns[customFormat];
  if (fmt) {
    const m = trimmed.match(fmt);
    if (m) {
      let y: string, mo: string, d: string, h: string, mi: string, s: string;
      
      if (customFormat.startsWith("DD-MM")) {
        [, d, mo, y, h = "00", mi = "00", s = "00"] = m;
      } else if (customFormat.startsWith("MM/DD")) {
        [, mo, d, y, h = "00", mi = "00", s = "00"] = m;
      } else {
        [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
      }
      
      const parsed = new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(s)
      );
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  return null;
}

export function parseTimestamp(ts: string): Date | null {
  return parseTimestampWithFormat(ts, "auto");
}

export interface CSVRow {
  timestamp?: string;
  sensor?: string;
  sensorName?: string;
  value?: string | number;
  [key: string]: unknown;
}

export async function parseCSVFile(
  file: File,
  ruleVersion: RuleVersion,
  timeConfig?: TimeParseConfig
): Promise<ImportValidationResult> {
  const config = timeConfig || loadTimeParseConfig();
  return new Promise((resolve) => {
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve(processParsedData(results.data, ruleVersion, results.errors, config));
      },
      error: (err) => {
        resolve({
          valid: false,
          errors: [
            {
              row: 0,
              column: "file",
              message: `CSV 解析失败: ${err.message}`,
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
          },
        });
      },
    });
  });
}

function processParsedData(
  rows: CSVRow[],
  ruleVersion: RuleVersion,
  parseErrors: Papa.ParseError[],
  timeConfig: TimeParseConfig
): ImportValidationResult {
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

  parseErrors.forEach((e) => {
    errors.push({
      row: e.row ?? 0,
      column: e.code ?? "unknown",
      message: e.message,
      type: "invalid_value",
    });
  });

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const tsRaw = String(row.timestamp ?? row.time ?? "");
    const sensorName = (row.sensor ?? row.sensorName ?? "") as string;
    const valueRaw = row.value ?? row.val ?? row.reading ?? "";

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
      id: `dp_${rowNum}_${Math.random().toString(36).slice(2, 10)}`,
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

export function generateSampleCSV(): string {
  const sensors = ["Temperature_A1", "Pressure_B2", "Vibration_C3"];
  const start = new Date("2024-01-15T08:00:00");
  const rows: string[] = ["timestamp,sensorName,value"];
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

    rows.push(`${ts.toISOString().replace("T", " ").slice(0, 19)},${sensor},${value.toFixed(3)}`);

    if (i === 168 && sensor === duplicateSensor) {
      rows.push(`${duplicateTs.toISOString().replace("T", " ").slice(0, 19)},${duplicateSensor},${(value + 0.01).toFixed(3)}`);
    }
  }

  return rows.join("\n");
}

export function generateMixedFormatSampleCSV(): string {
  const sensors = ["Temperature_A1", "Pressure_B2", "Vibration_C3"];
  const start = new Date("2024-01-15T08:00:00");
  const rows: string[] = ["timestamp,sensorName,value"];

  for (let i = 0; i < 30; i++) {
    const ts = new Date(start.getTime() + i * 30_000);
    const sensor = sensors[i % sensors.length];
    const value = 60 + i;

    let tsStr: string;
    switch (i % 5) {
      case 0:
        tsStr = ts.toISOString().replace("T", " ").slice(0, 19);
        break;
      case 1:
        tsStr = String(Math.floor(ts.getTime() / 1000));
        break;
      case 2:
        tsStr = String(ts.getTime());
        break;
      case 3:
        tsStr = ts.toISOString().replace("T", "/").replace(/:/g, "-").slice(0, 19).replace("/", " ");
        break;
      case 4:
        tsStr = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(ts.getDate()).padStart(2, "0")}_${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}${String(ts.getSeconds()).padStart(2, "0")}`;
        break;
      default:
        tsStr = ts.toISOString();
    }

    rows.push(`${tsStr},${sensor},${value.toFixed(3)}`);
  }

  return rows.join("\n");
}

export function buildDataExportRows(
  dataPoints: DataPoint[],
  parseMetadata?: ImportParseMetadata
): Array<Record<string, string | number>> {
  const conflictMap = new Map(
    (parseMetadata?.conflicts || []).map((c) => [`${c.rowNumber}__${c.rawValue}`, c])
  );

  return dataPoints.map((dp, idx) => {
    const conflictKey = `${idx + 2}__${dp.rawTimestamp}`;
    const conflict = conflictMap.get(conflictKey);

    return {
      行号: idx + 1,
      原始时间戳: dp.rawTimestamp,
      标准化时间: dp.timestamp,
      传感器名称: dp.sensorName,
      数值: dp.value,
      时间格式说明: dp.timeParseNote || conflict?.conflictReason || "",
      最终使用格式: conflict?.finalFormatUsed || parseMetadata?.timeConfig.preset || "auto",
    };
  });
}
