import Papa from "papaparse";
import type {
  DataPoint,
  ImportValidationResult,
  ImportError,
  RuleVersion,
} from "@/types";

export function parseTimestamp(ts: string): Date | null {
  if (!ts || typeof ts !== "string") return null;
  const trimmed = ts.trim();
  if (!trimmed) return null;

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  const formats = [
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,
  ];

  for (const fmt of formats) {
    const m = trimmed.match(fmt);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
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
  return null;
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
  ruleVersion: RuleVersion
): Promise<ImportValidationResult> {
  return new Promise((resolve) => {
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve(processParsedData(results.data, ruleVersion, results.errors));
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
        });
      },
    });
  });
}

function processParsedData(
  rows: CSVRow[],
  ruleVersion: RuleVersion,
  parseErrors: Papa.ParseError[]
): ImportValidationResult {
  const errors: ImportError[] = [];
  const warnings: string[] = [];
  const dataPoints: DataPoint[] = [];
  const validSensorNames = new Set(
    ruleVersion.sensorRules.map((s) => s.sensorName)
  );
  const seenKeys = new Set<string>();
  let duplicateCount = 0;

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
    const tsRaw = row.timestamp ?? row.time ?? "";
    const sensorName = (row.sensor ?? row.sensorName ?? "") as string;
    const valueRaw = row.value ?? row.val ?? row.reading ?? "";

    const ts = parseTimestamp(String(tsRaw));
    if (!ts) {
      errors.push({
        row: rowNum,
        column: "timestamp",
        message: `无效的时间戳格式: "${tsRaw}"`,
        type: "bad_timestamp",
      });
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

    const key = `${sensorName}__${ts.toISOString()}`;
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
      timestamp: ts.toISOString(),
      sensorName,
      value,
    });
  });

  if (duplicateCount > 0) {
    warnings.push(`检测到 ${duplicateCount} 条重复时间戳记录，将在异常检测中标记`);
  }

  const fatalErrors = errors.filter((e) => e.type !== "duplicate");
  return {
    valid: fatalErrors.length === 0,
    errors,
    warnings,
    dataPoints,
    rowCount: rows.length,
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
