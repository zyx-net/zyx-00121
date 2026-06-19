import type {
  ImportOperationLog,
  ImportOperationStatus,
  ImportErrorCategory,
  ImportConflictDetail,
  DataSourceType,
  TimeParseConfig,
  ImportValidationResult,
} from "@/types";
import { generateId } from "@/utils/statistics";

const LOG_STORAGE_KEY = "sensor_qa_import_operation_logs";
const MAX_LOGS = 100;

export function createOperationLog(
  sourceName: string,
  sourceType: DataSourceType,
  timeConfig: TimeParseConfig,
  hasBOM?: boolean
): ImportOperationLog {
  return {
    id: generateId("log"),
    operationId: generateId("op"),
    sourceName,
    sourceType,
    status: "pending",
    startedAt: new Date().toISOString(),
    timeConfig,
    adoptedRules: [],
    conflicts: [],
    recordCounts: {
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      skippedRows: 0,
      importedRows: 0,
    },
    hasBOM,
  };
}

export function updateLogStatus(
  log: ImportOperationLog,
  status: ImportOperationStatus,
  errorCategory?: ImportErrorCategory,
  errorMessage?: string
): ImportOperationLog {
  const updated: ImportOperationLog = {
    ...log,
    status,
  };
  if (status === "completed" || status === "failed" || status === "rolled_back") {
    updated.completedAt = new Date().toISOString();
  }
  if (errorCategory) {
    updated.errorCategory = errorCategory;
  }
  if (errorMessage) {
    updated.errorMessage = errorMessage;
  }
  return updated;
}

export function addConflict(
  log: ImportOperationLog,
  conflict: ImportConflictDetail
): ImportOperationLog {
  return {
    ...log,
    conflicts: [...log.conflicts, conflict],
  };
}

export function addAdoptedRule(
  log: ImportOperationLog,
  ruleType: string,
  ruleDescription: string,
  affectedRecords: number
): ImportOperationLog {
  const existingIndex = log.adoptedRules.findIndex((r) => r.ruleType === ruleType);
  const newRules = [...log.adoptedRules];
  if (existingIndex >= 0) {
    newRules[existingIndex] = {
      ...newRules[existingIndex],
      affectedRecords: newRules[existingIndex].affectedRecords + affectedRecords,
    };
  } else {
    newRules.push({
      ruleType,
      ruleDescription,
      affectedRecords,
    });
  }
  return {
    ...log,
    adoptedRules: newRules,
  };
}

export function updateRecordCounts(
  log: ImportOperationLog,
  validation: ImportValidationResult
): ImportOperationLog {
  const invalidRows = validation.errors.filter((e) => e.type !== "duplicate").length;
  const duplicateRows = validation.errors.filter((e) => e.type === "duplicate").length;
  return {
    ...log,
    recordCounts: {
      totalRows: validation.rowCount,
      validRows: validation.dataPoints.length,
      invalidRows,
      skippedRows: duplicateRows,
      importedRows: validation.valid ? validation.dataPoints.length : 0,
    },
  };
}

export function saveOperationLog(log: ImportOperationLog): void {
  try {
    const existing = loadAllLogs();
    const updated = [log, ...existing].slice(0, MAX_LOGS);
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    console.warn("Failed to save import operation log");
  }
}

export function loadAllLogs(): ImportOperationLog[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return [];
}

export function loadLogsByBatchNo(batchNo: string): ImportOperationLog[] {
  return loadAllLogs().filter((log) => log.batchNo === batchNo);
}

export function loadLogsBySource(sourceName: string): ImportOperationLog[] {
  return loadAllLogs().filter((log) => log.sourceName === sourceName);
}

export function clearAllLogs(): void {
  localStorage.removeItem(LOG_STORAGE_KEY);
}

export function categorizeImportError(error: Error): ImportErrorCategory {
  const message = error.message.toLowerCase();

  if (message.includes("permission") || message.includes("denied") || message.includes("access")) {
    return "permission_denied";
  }
  if (message.includes("duplicate") && message.includes("batch")) {
    return "duplicate_batch";
  }
  if (message.includes("duplicate") || message.includes("primary key")) {
    return "duplicate_primary_key";
  }
  if (message.includes("parse") || message.includes("json") || message.includes("csv")) {
    return "parse_error";
  }
  if (message.includes("file") || message.includes("read") || message.includes("not found")) {
    return "file_access_error";
  }
  if (message.includes("database") || message.includes("indexed") || message.includes("db")) {
    return "database_error";
  }
  if (message.includes("validation") || message.includes("invalid")) {
    return "validation_error";
  }
  return "unknown_error";
}

export function formatLogSummary(log: ImportOperationLog): string {
  const lines: string[] = [];
  lines.push(`[${log.startedAt}] ${log.status.toUpperCase()} - ${log.sourceName}`);
  if (log.batchNo) {
    lines.push(`  Batch: ${log.batchNo}`);
  }
  lines.push(`  Records: ${JSON.stringify(log.recordCounts)}`);
  if (log.adoptedRules.length > 0) {
    lines.push(`  Adopted Rules:`);
    for (const rule of log.adoptedRules) {
      lines.push(`    - ${rule.ruleType}: ${rule.ruleDescription} (${rule.affectedRecords} records)`);
    }
  }
  if (log.conflicts.length > 0) {
    lines.push(`  Conflicts: ${log.conflicts.length}`);
    for (const conflict of log.conflicts.slice(0, 5)) {
      lines.push(`    - Row ${conflict.rowNumber}: ${conflict.message}`);
    }
    if (log.conflicts.length > 5) {
      lines.push(`    ... and ${log.conflicts.length - 5} more`);
    }
  }
  if (log.errorCategory) {
    lines.push(`  Error: ${log.errorCategory} - ${log.errorMessage}`);
  }
  return lines.join("\n");
}

export function generateConflictReport(logs: ImportOperationLog[]): string {
  const totalConflicts = logs.reduce((sum, log) => sum + log.conflicts.length, 0);
  const byType: Record<string, number> = {};
  const byRule: Record<string, number> = {};

  for (const log of logs) {
    for (const conflict of log.conflicts) {
      byType[conflict.conflictType] = (byType[conflict.conflictType] || 0) + 1;
      byRule[conflict.adoptedRule] = (byRule[conflict.adoptedRule] || 0) + 1;
    }
  }

  const lines: string[] = [];
  lines.push("=== Import Conflict Report ===");
  lines.push(`Total operations: ${logs.length}`);
  lines.push(`Total conflicts: ${totalConflicts}`);
  lines.push("");
  lines.push("By conflict type:");
  for (const [type, count] of Object.entries(byType)) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push("");
  lines.push("By adopted rule:");
  for (const [rule, count] of Object.entries(byRule)) {
    lines.push(`  ${rule}: ${count}`);
  }
  return lines.join("\n");
}

export function checkWritePermission(path?: string): { permitted: boolean; reason?: string } {
  try {
    if (typeof window !== "undefined" && typeof navigator !== "undefined") {
      return { permitted: true };
    }
    return { permitted: true };
  } catch (e) {
    return {
      permitted: false,
      reason: (e as Error).message,
    };
  }
}

export function checkLogDirectoryPermission(): { permitted: boolean; reason?: string } {
  try {
    const testKey = "sensor_qa_permission_test";
    localStorage.setItem(testKey, "test");
    localStorage.removeItem(testKey);
    return { permitted: true };
  } catch (e) {
    return {
      permitted: false,
      reason: `无法写入 localStorage: ${(e as Error).message}`,
    };
  }
}
