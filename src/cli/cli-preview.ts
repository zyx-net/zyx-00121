#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";

import { detectTimeFormat, parseTimestampWithFormat, processParsedData } from "../utils/csvParser";
import { processParsedRows, detectFieldMapping } from "../utils/jsonParser";
import { generateSourceId } from "../utils/perSourceTimeConfig";
import { detectAnomalies } from "../utils/anomalyDetector";
import { generateId } from "../utils/statistics";
import { detectAndStripBOM, UTF8_BOM } from "../utils/bomUtils";

import type {
  RuleVersion,
  TimeParseConfig,
  TimeFormatPreset,
  DataSourceType,
  ImportValidationResult,
  DataPoint,
  PrecheckResult,
} from "../types";

const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_BLUE = "\x1b[44m";

const TL = "┌";
const TR = "┐";
const BL = "└";
const BR = "┘";
const H = "─";
const V = "│";
const LJ = "├";
const RJ = "┤";
const TJ = "┬";
const BJ = "┴";
const X = "┼";

function parseCSVContent(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  function splitCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = splitCSVLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = j < values.length ? values[j] : "";
    }
    rows.push(row);
  }

  return rows;
}

function createDefaultRule(): RuleVersion {
  const devId = generateId("dev");
  return {
    id: generateId("rv"),
    name: "默认质检规则",
    version: 1,
    createdAt: new Date().toISOString(),
    description: "系统默认规则，可根据实际需要修改",
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
    missingRules: [
      {
        id: generateId("mr"),
        sensorName: "Temperature_A1",
        maxGapSeconds: 120,
        maxConsecutiveMissing: 2,
      },
      {
        id: generateId("mr"),
        sensorName: "Pressure_B2",
        maxGapSeconds: 120,
        maxConsecutiveMissing: 2,
      },
      {
        id: generateId("mr"),
        sensorName: "Vibration_C3",
        maxGapSeconds: 120,
        maxConsecutiveMissing: 2,
      },
    ],
  };
}

function parseArgs(argv: string[]): {
  filePath: string;
  format: "csv" | "json" | "auto";
  timePreset: TimeFormatPreset;
  customFormat: string | undefined;
  exportPath: string | undefined;
  showFinalColumns: boolean;
} {
  const args = argv.slice(2);
  if (args.length === 0) {
    console.error(`${RED}Error: File path is required${R}`);
    console.error(`Usage: cli-preview.ts <file-path> [--format csv|json] [--time-preset auto|unix_seconds|unix_milliseconds|custom] [--custom-format "YYYY-MM-DD HH:mm:ss"] [--export output.json] [--show-final-columns]`);
    process.exit(1);
  }

  let filePath = "";
  let format: "csv" | "json" | "auto" = "auto";
  let timePreset: TimeFormatPreset = "auto";
  let customFormat: string | undefined;
  let exportPath: string | undefined;
  let showFinalColumns = false;

  let i = 0;
  while (i < args.length) {
    if (args[i] === "--format" && i + 1 < args.length) {
      const val = args[i + 1];
      if (val !== "csv" && val !== "json" && val !== "auto") {
        console.error(`${RED}Error: --format must be csv, json, or auto${R}`);
        process.exit(1);
      }
      format = val;
      i += 2;
    } else if (args[i] === "--time-preset" && i + 1 < args.length) {
      const val = args[i + 1] as TimeFormatPreset;
      if (!["auto", "unix_seconds", "unix_milliseconds", "custom"].includes(val)) {
        console.error(`${RED}Error: --time-preset must be auto, unix_seconds, unix_milliseconds, or custom${R}`);
        process.exit(1);
      }
      timePreset = val;
      i += 2;
    } else if (args[i] === "--custom-format" && i + 1 < args.length) {
      customFormat = args[i + 1];
      i += 2;
    } else if (args[i] === "--export" && i + 1 < args.length) {
      exportPath = args[i + 1];
      i += 2;
    } else if (args[i] === "--show-final-columns") {
      showFinalColumns = true;
      i++;
    } else if (!args[i].startsWith("--")) {
      filePath = args[i];
      i++;
    } else {
      console.error(`${RED}Error: Unknown argument: ${args[i]}${R}`);
      process.exit(1);
    }
  }

  if (!filePath) {
    console.error(`${RED}Error: File path is required${R}`);
    process.exit(1);
  }

  if (timePreset === "custom" && !customFormat) {
    console.error(`${RED}Error: --custom-format is required when --time-preset is custom${R}`);
    process.exit(1);
  }

  return { filePath, format, timePreset, customFormat, exportPath, showFinalColumns };
}

function detectFormat(filePath: string, forced?: "csv" | "json" | "auto"): DataSourceType {
  if (forced === "csv") return "csv";
  if (forced === "json") return "json";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv" || ext === ".tsv") return "csv";
  if (ext === ".json" || ext === ".jsonl") return "json";
  return "csv";
}

function sectionTitle(title: string): string {
  const inner = ` ${title} `;
  const padLen = Math.max(60, inner.length + 4);
  const leftPad = Math.floor((padLen - inner.length) / 2);
  const rightPad = padLen - inner.length - leftPad;
  const line = H.repeat(padLen);
  return (
    `${CYAN}${BOLD}${LJ}${line}${RJ}${R}\n` +
    `${CYAN}${BOLD}${V}${R}${BG_BLUE}${WHITE}${BOLD}${" ".repeat(leftPad)}${inner}${" ".repeat(rightPad)}${R}${CYAN}${BOLD}${V}${R}\n` +
    `${CYAN}${BOLD}${LJ}${line}${RJ}${R}`
  );
}

function kvLine(key: string, value: string, keyColor = CYAN, valColor = WHITE): string {
  return `${V} ${keyColor}${BOLD}${key}:${R} ${valColor}${value}${R}`;
}

function stripAnsiLen(s: string): number {
  let len = 0;
  let inEscape = false;
  for (const ch of s) {
    if (ch === "\x1b") { inEscape = true; continue; }
    if (inEscape) {
      if (/[a-zA-Z]/.test(ch)) inEscape = false;
      continue;
    }
    len++;
  }
  return len;
}

function printBox(lines: string[]): void {
  const maxW = Math.max(...lines.map((l) => stripAnsiLen(l))) + 2;
  console.log(`${CYAN}${TL}${H.repeat(maxW)}${TR}${R}`);
  for (const line of lines) {
    const stripped = stripAnsiLen(line);
    const padding = maxW - stripped - 1;
    console.log(`${CYAN}${V}${R} ${line}${" ".repeat(Math.max(0, padding))}${CYAN}${V}${R}`);
  }
  console.log(`${CYAN}${BL}${H.repeat(maxW)}${BR}${R}`);
}

function formatTimestampLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function runPrecheck(
  sourceType: DataSourceType,
  sourceName: string,
  rawData: Array<Record<string, unknown>>,
  ruleVersion: RuleVersion,
  timeConfig: TimeParseConfig,
  sourceHash: string,
  hasBOM: boolean
): PrecheckResult {
  const fieldMapping = detectFieldMapping(rawData as Array<Record<string, unknown>>);

  let validationResult: ImportValidationResult;

  if (sourceType === "csv") {
    const csvRows = rawData.map((row) => {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        result[k] = v;
      }
      return result as { timestamp?: string; sensor?: string; sensorName?: string; value?: string | number; [key: string]: unknown };
    });
    validationResult = processParsedData(csvRows as any[], ruleVersion, [], timeConfig, sourceHash);
  } else {
    validationResult = processParsedRows(rawData as Array<Record<string, unknown>>, ruleVersion, timeConfig, sourceHash);
  }

  validationResult.parseMetadata.hasBOM = hasBOM;
  validationResult.parseMetadata.sourceName = sourceName;
  validationResult.parseMetadata.sourceType = sourceType;

  const anomalies = detectAnomalies(validationResult.dataPoints, ruleVersion);

  const autoDetectedFormatCounts = validationResult.parseMetadata.autoDetectedFormatCounts;
  const conflicts = validationResult.parseMetadata.conflicts;
  const parseErrorCount = validationResult.parseMetadata.parseErrors.length;

  const byType: Record<string, number> = {};
  const bySensor: Record<string, number> = {};
  for (const a of anomalies) {
    byType[a.type] = (byType[a.type] || 0) + 1;
    bySensor[a.sensorName] = (bySensor[a.sensorName] || 0) + 1;
  }

  const keyColumnsPreview = validationResult.dataPoints.slice(0, 10).map((dp, idx) => ({
    rowNumber: idx + 1,
    rawTimestamp: dp.rawTimestamp,
    standardizedTimestamp: formatTimestampLocal(dp.timestamp),
    sensorName: dp.sensorName,
    value: dp.value,
    timeFormatUsed: timeConfig.preset === "auto" ? "auto" : timeConfig.preset,
    parseNote: dp.timeParseNote,
  }));

  return {
    sourceType,
    sourceName,
    fieldMapping,
    timeParsePreview: {
      config: timeConfig,
      formatDistribution: autoDetectedFormatCounts,
      conflicts,
      previewRows: [],
      parseErrorCount,
    },
    anomalySummary: {
      totalAnomalies: anomalies.length,
      byType,
      bySensor,
    },
    keyColumnsPreview,
    validationResult,
  };
}

function renderPreview(result: PrecheckResult): void {
  const lines: string[] = [];

  console.log(`\n${CYAN}${BOLD}${"═".repeat(60)}${R}`);
  console.log(`${BG_BLUE}${WHITE}${BOLD}     IMPORT PREVIEW — ${result.sourceName}     ${R}`);
  console.log(`${CYAN}${BOLD}${"═".repeat(60)}${R}\n`);

  console.log(sectionTitle("SOURCE INFO"));
  printBox([
    kvLine("Type", result.sourceType.toUpperCase(), CYAN, GREEN),
    kvLine("Name", result.sourceName, CYAN, WHITE),
    kvLine("Valid", result.validationResult.valid ? "✔ YES" : "✘ NO", CYAN, result.validationResult.valid ? GREEN : RED),
    kvLine("Total Rows", String(result.validationResult.rowCount), CYAN, WHITE),
    kvLine("Data Points", String(result.validationResult.dataPoints.length), CYAN, WHITE),
    kvLine("UTF-8 BOM", result.validationResult.parseMetadata.hasBOM ? "✔ DETECTED (Windows format)" : "✘ NONE", CYAN, result.validationResult.parseMetadata.hasBOM ? BLUE : DIM),
  ]);
  console.log();

  console.log(sectionTitle("FIELD MAPPING"));
  const fm = result.fieldMapping;
  const mappingLines: string[] = [];
  mappingLines.push(kvLine("Detected", fm.detectedFields.join(", ") || "(none)", CYAN, WHITE));
  const tsField = fm.mappedFields.timestamp ?? "(unmapped)";
  const snField = fm.mappedFields.sensorName ?? "(unmapped)";
  const valField = fm.mappedFields.value ?? "(unmapped)";
  mappingLines.push(kvLine("timestamp →", tsField, BLUE, fm.mappedFields.timestamp ? GREEN : RED));
  mappingLines.push(kvLine("sensorName →", snField, BLUE, fm.mappedFields.sensorName ? GREEN : RED));
  mappingLines.push(kvLine("value →", valField, BLUE, fm.mappedFields.value ? GREEN : RED));
  mappingLines.push(kvLine("Unmapped", fm.unmappedFields.join(", ") || "(none)", CYAN, fm.unmappedFields.length ? YELLOW : DIM));
  mappingLines.push(kvLine("Missing", fm.missingFields.join(", ") || "(none)", CYAN, fm.missingFields.length ? RED : DIM));
  printBox(mappingLines);
  console.log();

  console.log(sectionTitle("TIME PARSING"));
  const tp = result.timeParsePreview;
  const timeLines: string[] = [];
  timeLines.push(kvLine("Preset", tp.config.preset, CYAN, YELLOW));
  if (tp.config.customFormat) {
    timeLines.push(kvLine("Custom Format", tp.config.customFormat, CYAN, WHITE));
  }
  const distEntries = Object.entries(tp.formatDistribution);
  if (distEntries.length > 0) {
    timeLines.push(`${V} ${BLUE}${BOLD}Format Distribution:${R}`);
    for (const [fmt, count] of distEntries) {
      const bar = "█".repeat(Math.min(count, 30));
      timeLines.push(`${V}   ${MAGENTA}${fmt.padEnd(24)}${R} ${GREEN}${bar}${R} ${WHITE}${count}${R}`);
    }
  }
  timeLines.push(kvLine("Conflicts", String(tp.conflicts.length), CYAN, tp.conflicts.length > 0 ? RED : GREEN));
  timeLines.push(kvLine("Parse Errors", String(tp.parseErrorCount), CYAN, tp.parseErrorCount > 0 ? RED : GREEN));
  printBox(timeLines);
  console.log();

  console.log(sectionTitle("ANOMALY SUMMARY"));
  const anomalyLines: string[] = [];
  anomalyLines.push(kvLine("Total", String(result.anomalySummary.totalAnomalies), CYAN, result.anomalySummary.totalAnomalies > 0 ? YELLOW : GREEN));
  const typeEntries = Object.entries(result.anomalySummary.byType);
  if (typeEntries.length > 0) {
    anomalyLines.push(`${V} ${BLUE}${BOLD}By Type:${R}`);
    for (const [t, c] of typeEntries) {
      anomalyLines.push(`${V}   ${MAGENTA}${t.padEnd(24)}${R} ${WHITE}${c}${R}`);
    }
  }
  const sensorEntries = Object.entries(result.anomalySummary.bySensor);
  if (sensorEntries.length > 0) {
    anomalyLines.push(`${V} ${BLUE}${BOLD}By Sensor:${R}`);
    for (const [s, c] of sensorEntries) {
      anomalyLines.push(`${V}   ${MAGENTA}${s.padEnd(24)}${R} ${WHITE}${c}${R}`);
    }
  }
  printBox(anomalyLines);
  console.log();

  console.log(sectionTitle("KEY COLUMNS PREVIEW (first 10 rows)"));
  const cols = ["Row#", "Raw Timestamp", "Standardized", "Sensor", "Value", "Format"];
  const widths = [5, 24, 20, 16, 10, 10];
  const headerLine = cols.map((c, i) => c.padEnd(widths[i])).join(` ${CYAN}${V}${R} `);
  const separator = widths.map((w) => H.repeat(w)).join(`${CYAN}${X}${R}`);

  console.log(`${CYAN}${LJ}${H.repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 3)}${RJ}${R}`);
  console.log(`${V} ${BOLD}${WHITE}${headerLine}${R} ${CYAN}${V}${R}`);
  console.log(`${CYAN}${LJ}${separator}${RJ}${R}`);

  for (const row of result.keyColumnsPreview) {
    const cells = [
      String(row.rowNumber).padEnd(widths[0]),
      row.rawTimestamp.padEnd(widths[1]),
      row.standardizedTimestamp.padEnd(widths[2]),
      row.sensorName.padEnd(widths[3]),
      row.value.toFixed(3).padEnd(widths[4]),
      row.timeFormatUsed.padEnd(widths[5]),
    ];
    const line = cells.map((c, i) => {
      const sLen = stripAnsiLen(c);
      if (sLen < widths[i]) c.padEnd(widths[i] - sLen + c.length);
      return c;
    }).join(` ${CYAN}${V}${R} `);
    console.log(`${V} ${line} ${CYAN}${V}${R}`);
  }
  console.log(`${CYAN}${BL}${H.repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 3)}${BR}${R}`);
  console.log();

  if (result.timeParsePreview.conflicts.length > 0) {
    console.log(sectionTitle("CONFLICT DETAILS"));
    const conflictCols = ["Row", "Raw Value", "Auto Fmt", "Manual Fmt", "Auto Result", "Manual Result", "Adopted", "Reason"];
    const cWidths = [5, 20, 14, 14, 22, 22, 10, 30];
    const cHeader = conflictCols.map((c, i) => c.padEnd(cWidths[i])).join(` ${CYAN}${V}${R} `);
    const cSep = cWidths.map((w) => H.repeat(w)).join(`${CYAN}${X}${R}`);

    console.log(`${CYAN}${LJ}${H.repeat(cWidths.reduce((a, b) => a + b, 0) + (cWidths.length - 1) * 3)}${RJ}${R}`);
    console.log(`${V} ${BOLD}${WHITE}${cHeader}${R} ${CYAN}${V}${R}`);
    console.log(`${CYAN}${LJ}${cSep}${RJ}${R}`);

    for (const c of result.timeParsePreview.conflicts) {
      const autoTs = c.autoParsedTimestamp ? formatTimestampLocal(c.autoParsedTimestamp) : "(null)";
      const userTs = c.userParsedTimestamp ? formatTimestampLocal(c.userParsedTimestamp) : "(null)";
      const cells = [
        String(c.rowNumber).padEnd(cWidths[0]),
        c.rawValue.substring(0, cWidths[1] - 1).padEnd(cWidths[1]),
        c.autoDetectedFormat.padEnd(cWidths[2]),
        c.userSelectedFormat.padEnd(cWidths[3]),
        autoTs.padEnd(cWidths[4]),
        userTs.padEnd(cWidths[5]),
        c.finalFormatUsed.padEnd(cWidths[6]),
        c.conflictReason.substring(0, cWidths[7] - 1).padEnd(cWidths[7]),
      ];
      console.log(`${V} ${cells.join(` ${CYAN}${V}${R} `)} ${CYAN}${V}${R}`);
    }
    console.log(`${CYAN}${BL}${H.repeat(cWidths.reduce((a, b) => a + b, 0) + (cWidths.length - 1) * 3)}${BR}${R}`);
    console.log();
  }

  if (result.validationResult.errors.length > 0) {
    console.log(sectionTitle("IMPORT ERRORS"));
    const errLines: string[] = [];
    for (const err of result.validationResult.errors.slice(0, 20)) {
      errLines.push(`${V} ${RED}Row ${err.row}${R} ${DIM}[${err.type}]${R} ${WHITE}${err.message}${R}`);
    }
    if (result.validationResult.errors.length > 20) {
      errLines.push(`${V} ${DIM}... and ${result.validationResult.errors.length - 20} more errors${R}`);
    }
    printBox(errLines);
    console.log();
  }

  if (result.validationResult.warnings.length > 0) {
    console.log(sectionTitle("WARNINGS"));
    const warnLines: string[] = [];
    for (const w of result.validationResult.warnings) {
      warnLines.push(`${V} ${YELLOW}⚠${R} ${WHITE}${w}${R}`);
    }
    printBox(warnLines);
    console.log();
  }

  console.log(sectionTitle("FINAL WRITE COLUMNS"));
  const finalCols = ["id", "timestamp", "sensorName", "value", "status", "anomalies", "rawTimestamp", "timeParseNote"];
  const fWidths = [26, 20, 16, 10, 12, 24, 24, 30];
  const fHeader = finalCols.map((c, i) => c.padEnd(fWidths[i])).join(` ${CYAN}${V}${R} `);
  const fSep = fWidths.map((w) => H.repeat(w)).join(`${CYAN}${X}${R}`);

  console.log(`${CYAN}${LJ}${H.repeat(fWidths.reduce((a, b) => a + b, 0) + (fWidths.length - 1) * 3)}${RJ}${R}`);
  console.log(`${V} ${BOLD}${WHITE}${fHeader}${R} ${CYAN}${V}${R}`);
  console.log(`${CYAN}${LJ}${fSep}${RJ}${R}`);

  for (const dp of result.validationResult.dataPoints.slice(0, 5)) {
    const cells = [
      dp.id.padEnd(fWidths[0]),
      formatTimestampLocal(dp.timestamp).padEnd(fWidths[1]),
      dp.sensorName.padEnd(fWidths[2]),
      dp.value.toFixed(3).padEnd(fWidths[3]),
      dp.status.padEnd(fWidths[4]),
      (dp.anomalies?.join(",") || "(none)").substring(0, fWidths[5] - 1).padEnd(fWidths[5]),
      dp.rawTimestamp.substring(0, fWidths[6] - 1).padEnd(fWidths[6]),
      (dp.timeParseNote || "(none)").substring(0, fWidths[7] - 1).padEnd(fWidths[7]),
    ];
    console.log(`${V} ${cells.join(` ${CYAN}${V}${R} `)} ${CYAN}${V}${R}`);
  }
  console.log(`${CYAN}${BL}${H.repeat(fWidths.reduce((a, b) => a + b, 0) + (fWidths.length - 1) * 3)}${BR}${R}`);
  console.log();
}

function exportResult(result: PrecheckResult, exportPath: string): void {
  const exportData = {
    exportVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    sourceName: result.sourceName,
    sourceType: result.sourceType,
    hasBOM: result.validationResult.parseMetadata.hasBOM,
    timeConfig: result.timeParsePreview.config,
    fieldMapping: result.fieldMapping,
    anomalySummary: result.anomalySummary,
    keyColumnsPreview: result.keyColumnsPreview,
    timeConflicts: result.timeParsePreview.conflicts,
    validationResult: {
      valid: result.validationResult.valid,
      errors: result.validationResult.errors,
      warnings: result.validationResult.warnings,
      rowCount: result.validationResult.rowCount,
      parseMetadata: result.validationResult.parseMetadata,
    },
    dataPoints: result.validationResult.dataPoints.map((dp) => ({
      id: dp.id,
      timestamp: dp.timestamp,
      sensorName: dp.sensorName,
      value: dp.value,
      status: dp.status,
      anomalies: dp.anomalies,
      rawTimestamp: dp.rawTimestamp,
      timeParseNote: dp.timeParseNote,
      sourceId: dp.sourceId,
      ruleVersionId: dp.ruleVersionId,
    })),
  };

  fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2), "utf-8");
  console.log(`${GREEN}✔ Exported to: ${exportPath}${R}`);
}

function main(): void {
  const { filePath, format, timePreset, customFormat, exportPath, showFinalColumns } = parseArgs(process.argv);

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`${RED}Error: File not found: ${resolvedPath}${R}`);
    process.exit(1);
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(resolvedPath, "utf-8");
  } catch (e) {
    console.error(`${RED}Error reading file: ${(e as Error).message}${R}`);
    process.exit(1);
  }

  const { text: content, hasBOM } = detectAndStripBOM(rawContent);

  const sourceType = detectFormat(resolvedPath, format);
  const sourceName = path.basename(resolvedPath);
  const sourceHash = generateSourceId(sourceName);

  const timeConfig: TimeParseConfig = {
    preset: timePreset,
    customFormat: timePreset === "custom" ? customFormat : undefined,
  };

  const ruleVersion = createDefaultRule();

  if (hasBOM) {
    console.log(`${BLUE}ℹ UTF-8 BOM detected (Windows format), automatically stripped${R}\n`);
  }

  let rawData: Array<Record<string, unknown>>;

  if (sourceType === "csv") {
    rawData = parseCSVContent(content) as Array<Record<string, unknown>>;
  } else {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        rawData = parsed.filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item));
      } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.data)) {
          rawData = obj.data.filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item));
        } else if (Array.isArray(obj.records)) {
          rawData = obj.records.filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item));
        } else {
          console.error(`${RED}Error: JSON structure not supported. Expected array, { data: [...] }, or { records: [...] }${R}`);
          process.exit(1);
        }
      } else {
        console.error(`${RED}Error: JSON structure not supported${R}`);
        process.exit(1);
      }
    } catch (e) {
      console.error(`${RED}Error parsing JSON: ${(e as Error).message}${R}`);
      process.exit(1);
    }
  }

  if (rawData.length === 0) {
    console.error(`${YELLOW}Warning: No data rows found in file${R}`);
    process.exit(1);
  }

  const precheckResult = runPrecheck(sourceType, sourceName, rawData, ruleVersion, timeConfig, sourceHash, hasBOM);
  renderPreview(precheckResult);

  if (exportPath) {
    exportResult(precheckResult, path.resolve(exportPath));
  }

  process.exit(0);
}

main();
