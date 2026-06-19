import { create } from "zustand";
import type {
  Batch,
  ReviewDecision,
  ReviewLabel,
  RuleVersion,
  RollbackLog,
  ImportParseMetadata,
  DataPoint,
  ImportConflictDetail,
  ImportError,
} from "@/types";
import { generateId } from "@/utils/statistics";
import {
  batchExistsByNo,
  getAllBatchList,
  getAllRuleVersions,
  getFullBatch,
  getRuleVersion,
  saveBatchWithData,
  saveReviewDecision,
  saveRuleVersion,
} from "@/db/database";
import { detectAnomalies } from "@/utils/anomalyDetector";
import { computeStatistics } from "@/utils/statistics";
import type { StatisticsSummary } from "@/types";
import { db } from "@/db/database";
import { remapDecisionsAfterReDetect } from "@/utils/anomalyFingerprint";
import {
  createOperationLog,
  updateLogStatus,
  addConflict,
  addAdoptedRule,
  updateRecordCounts,
  saveOperationLog,
  categorizeImportError,
  checkLogDirectoryPermission,
  checkWritePermission,
} from "@/utils/importLogger";

interface ToastMessage {
  id: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
}

interface AppState {
  ruleVersions: RuleVersion[];
  currentRuleVersionId: string | null;
  batchList: Array<Omit<Batch, "dataPoints" | "anomalies" | "decisions">>;
  currentBatch: Batch | null;
  currentStats: StatisticsSummary | null;
  toasts: ToastMessage[];
  loading: boolean;

  initStore: () => Promise<void>;
  loadRuleVersions: () => Promise<void>;
  createRuleVersion: (rule: Omit<RuleVersion, "id" | "version" | "createdAt">) => Promise<RuleVersion>;
  selectRuleVersion: (id: string) => void;
  getCurrentRule: () => RuleVersion | undefined;

  loadBatchList: () => Promise<void>;
  loadBatch: (batchId: string) => Promise<void>;
  createBatch: (
    batchNo: string,
    note: string,
    ruleVersionId: string,
    dataPoints: Batch["dataPoints"],
    parseMetadata?: ImportParseMetadata,
    validationResult?: { valid: boolean; errors: Array<{ type: string; row: number; column: string; message: string }>; rowCount: number }
  ) => Promise<Batch>;
  rollbackBatchById: (batchId: string, reason: string) => Promise<boolean>;
  reimportBatch: (
    originalBatchId: string,
    newBatchNo: string,
    note?: string
  ) => Promise<Batch | null>;
  checkBatchExists: (batchNo: string) => Promise<boolean>;

  addDecision: (
    batchId: string,
    anomalyId: string,
    label: ReviewLabel,
    comment?: string
  ) => Promise<void>;
  batchAddDecision: (
    batchId: string,
    anomalyIds: string[],
    label: ReviewLabel
  ) => Promise<void>;
  clearCurrentBatch: () => void;

  rollbackBatch: (
    batchId: string,
    toRuleVersionId: string,
    reason: string,
    reDetect?: boolean
  ) => Promise<void>;

  pushToast: (type: ToastMessage["type"], message: string) => void;
  removeToast: (id: string) => void;
}

const initialStats: StatisticsSummary = {
  totalAnomalies: 0,
  byType: { missing: 0, out_of_range: 0, jump: 0, duplicate_timestamp: 0 },
  byLabel: { confirmed_fault: 0, false_positive: 0, ignored: 0, unreviewed: 0 },
  bySensor: {},
  confirmedFaultRate: 0,
  falsePositiveRate: 0,
  completionRate: 0,
};

export const useAppStore = create<AppState>((set, get) => ({
  ruleVersions: [],
  currentRuleVersionId: null,
  batchList: [],
  currentBatch: null,
  currentStats: null,
  toasts: [],
  loading: false,

  initStore: async () => {
    set({ loading: true });
    await get().loadRuleVersions();
    await get().loadBatchList();

    const savedCurrent = localStorage.getItem("sensor_qa_current_rule");
    if (savedCurrent && get().ruleVersions.some((r) => r.id === savedCurrent)) {
      set({ currentRuleVersionId: savedCurrent });
    } else if (get().ruleVersions.length > 0) {
      set({ currentRuleVersionId: get().ruleVersions[0].id });
    }
    set({ loading: false });
  },

  loadRuleVersions: async () => {
    const versions = await getAllRuleVersions();
    if (versions.length === 0) {
      const defaultRule = createDefaultRule();
      await saveRuleVersion(defaultRule);
      set({ ruleVersions: [defaultRule], currentRuleVersionId: defaultRule.id });
    } else {
      set({ ruleVersions: versions });
    }
  },

  createRuleVersion: async (rule) => {
    const existing = await getAllRuleVersions();
    const maxVersion = existing.reduce((m, r) => Math.max(m, r.version), 0);
    const newRule: RuleVersion = {
      ...rule,
      id: generateId("rv"),
      version: maxVersion + 1,
      createdAt: new Date().toISOString(),
    };
    await saveRuleVersion(newRule);
    set((s) => ({
      ruleVersions: [newRule, ...s.ruleVersions],
      currentRuleVersionId: newRule.id,
    }));
    localStorage.setItem("sensor_qa_current_rule", newRule.id);
    get().pushToast("success", `规则版本 v${newRule.version} 已保存`);
    return newRule;
  },

  selectRuleVersion: (id) => {
    set({ currentRuleVersionId: id });
    localStorage.setItem("sensor_qa_current_rule", id);
  },

  getCurrentRule: () => {
    const { ruleVersions, currentRuleVersionId } = get();
    return ruleVersions.find((r) => r.id === currentRuleVersionId);
  },

  loadBatchList: async () => {
    const list = await getAllBatchList();
    set({ batchList: list });
  },

  loadBatch: async (batchId) => {
    set({ loading: true });
    const batch = await getFullBatch(batchId);
    if (batch) {
      const stats = computeStatistics(batch.anomalies, batch.decisions);
      set({ currentBatch: batch, currentStats: stats });
    }
    set({ loading: false });
  },

  createBatch: async (batchNo, note, ruleVersionId, dataPoints, parseMetadata, validationResult) => {
    const sourceName = parseMetadata?.sourceName || "unknown_source";
    const sourceType = parseMetadata?.sourceType || "csv";
    const hasBOM = parseMetadata?.hasBOM;
    const timeConfig = parseMetadata?.timeConfig || { preset: "auto" };

    let operationLog = createOperationLog(sourceName, sourceType, timeConfig, hasBOM);
    operationLog = updateLogStatus(operationLog, "importing");

    try {
      const writePerm = checkWritePermission();
      if (!writePerm.permitted) {
        operationLog = updateLogStatus(
          operationLog,
          "failed",
          "permission_denied",
          `目标文件无写权限: ${writePerm.reason}`
        );
        saveOperationLog(operationLog);
        throw new Error(`目标文件无写权限: ${writePerm.reason}`);
      }

      const logPerm = checkLogDirectoryPermission();
      if (!logPerm.permitted) {
        get().pushToast("warning", `日志目录不可写: ${logPerm.reason}，操作日志将不会被保存`);
      }

      const existingBatch = await batchExistsByNo(batchNo);
      if (existingBatch) {
        const conflict: ImportConflictDetail = {
          rowNumber: 0,
          primaryKey: batchNo,
          conflictType: "duplicate_batch_no",
          adoptedRule: "abort",
          message: `批次编号 ${batchNo} 已存在，请使用其他编号`,
        };
        operationLog = addConflict(operationLog, conflict);
        operationLog = addAdoptedRule(
          operationLog,
          "duplicate_batch",
          "批次编号重复时终止导入",
          1
        );
        operationLog = updateLogStatus(
          operationLog,
          "failed",
          "duplicate_batch",
          `批次编号 ${batchNo} 已存在`
        );
        operationLog.batchNo = batchNo;
        saveOperationLog(operationLog);
        throw new Error(`批次编号 ${batchNo} 已存在，请使用其他编号`);
      }

      const rule = await getRuleVersion(ruleVersionId);
      if (!rule) {
        operationLog = updateLogStatus(
          operationLog,
          "failed",
          "validation_error",
          "规则版本不存在"
        );
        operationLog.batchNo = batchNo;
        saveOperationLog(operationLog);
        throw new Error("规则版本不存在");
      }

      if (validationResult) {
        operationLog = updateRecordCounts(operationLog, {
          valid: validationResult.valid,
          warnings: [],
          dataPoints,
          parseMetadata: parseMetadata || {
            timeConfig,
            conflicts: [],
            autoDetectedFormatCounts: {},
            parseErrors: [],
            importedAt: new Date().toISOString(),
          },
          errors: validationResult.errors.map(e => ({
            ...e,
            column: e.column || "unknown",
            type: (e.type as ImportError["type"]),
          })),
          rowCount: validationResult.rowCount,
        });

        const duplicateErrors = validationResult.errors.filter((e) => e.type === "duplicate");
        if (duplicateErrors.length > 0) {
          operationLog = addAdoptedRule(
            operationLog,
            "duplicate_timestamp",
            "传感器+时间戳重复时保留供异常检测，不跳过",
            duplicateErrors.length
          );
          for (const err of duplicateErrors.slice(0, 10)) {
            operationLog = addConflict(operationLog, {
              rowNumber: err.row,
              primaryKey: err.message,
              conflictType: "duplicate_sensor_timestamp",
              adoptedRule: "skip",
              message: err.message,
            });
          }
        }

        const fatalErrors = validationResult.errors.filter((e) => e.type !== "duplicate");
        if (fatalErrors.length > 0) {
          operationLog = addAdoptedRule(
            operationLog,
            "invalid_record",
            "无效记录（坏时间戳、未知传感器、无效数值）跳过",
            fatalErrors.length
          );
        }
      }

      if (parseMetadata?.conflicts && parseMetadata.conflicts.length > 0) {
        operationLog = addAdoptedRule(
          operationLog,
          "time_parse_conflict",
          "时间解析冲突时优先使用用户手动配置的格式",
          parseMetadata.conflicts.length
        );
      }

      const seenKeys = new Set<string>();
      const pkConflicts: ImportConflictDetail[] = [];
      for (let i = 0; i < dataPoints.length; i++) {
        const dp = dataPoints[i];
        const key = `${dp.sensorName}__${dp.timestamp}`;
        if (seenKeys.has(key)) {
          pkConflicts.push({
            rowNumber: i + 2,
            primaryKey: key,
            conflictType: "duplicate_sensor_timestamp",
            adoptedRule: "skip",
            message: `传感器 ${dp.sensorName} 在 ${dp.timestamp} 存在重复记录`,
          });
        }
        seenKeys.add(key);
      }
      if (pkConflicts.length > 0) {
        for (const conflict of pkConflicts.slice(0, 10)) {
          operationLog = addConflict(operationLog, conflict);
        }
        operationLog = addAdoptedRule(
          operationLog,
          "primary_key_conflict",
          "导入前检测到主键（传感器+时间戳）冲突，保留第一条",
          pkConflicts.length
        );
      }

      const anomalies = detectAnomalies(dataPoints, rule);
      const batch: Batch = {
        id: generateId("batch"),
        batchNo,
        ruleVersionId,
        importedAt: new Date().toISOString(),
        note,
        totalRows: dataPoints.length,
        status: "reviewing",
        dataPoints,
        anomalies,
        decisions: [],
        rollbackLogs: [],
        parseMetadata,
      };

      await saveBatchWithData(batch);
      await get().loadBatchList();

      operationLog.batchNo = batchNo;
      operationLog = updateLogStatus(operationLog, "completed");
      operationLog.recordCounts.importedRows = dataPoints.length;
      saveOperationLog(operationLog);

      const conflictCount = parseMetadata?.conflicts?.length || 0;
      const conflictMsg = conflictCount > 0 ? `，其中 ${conflictCount} 条存在时间解析冲突` : "";
      const bomMsg = hasBOM ? "（含 UTF-8 BOM）" : "";
      get().pushToast("success", `批次 ${batchNo}${bomMsg} 导入成功，检测到 ${anomalies.length} 个异常${conflictMsg}`);

      const stats = computeStatistics(batch.anomalies, batch.decisions);
      set({ currentBatch: batch, currentStats: stats });
      return batch;
    } catch (e) {
      const error = e as Error;
      const category = categorizeImportError(error);
      operationLog = updateLogStatus(operationLog, "failed", category, error.message);
      operationLog.batchNo = batchNo;
      saveOperationLog(operationLog);
      get().pushToast("error", `导入失败: ${error.message}`);
      throw e;
    }
  },

  rollbackBatchById: async (batchId: string, reason: string) => {
    const batch = await getFullBatch(batchId);
    if (!batch) {
      get().pushToast("error", "批次不存在");
      return false;
    }

    const sourceName = batch.parseMetadata?.sourceName || batch.batchNo;
    const sourceType = batch.parseMetadata?.sourceType || "csv";
    const timeConfig = batch.parseMetadata?.timeConfig || { preset: "auto" };
    let operationLog = createOperationLog(sourceName, sourceType, timeConfig, batch.parseMetadata?.hasBOM);
    operationLog = updateLogStatus(operationLog, "rolling_back");
    operationLog.batchNo = batch.batchNo;

    try {
      await db.transaction("rw", db.batches, db.dataPoints, db.anomalies, db.reviewDecisions, async () => {
        await db.reviewDecisions.where("batchId").equals(batchId).delete();
        await db.anomalies.where("batchId").equals(batchId).delete();
        await db.dataPoints.where("batchId").equals(batchId).delete();
        await db.batches.where("id").equals(batchId).delete();
      });

      operationLog = addAdoptedRule(
        operationLog,
        "rollback",
        reason,
        batch.totalRows
      );
      operationLog = updateLogStatus(operationLog, "completed");
      operationLog.recordCounts = {
        totalRows: batch.totalRows,
        validRows: batch.dataPoints.length,
        invalidRows: 0,
        skippedRows: 0,
        importedRows: 0,
      };
      saveOperationLog(operationLog);

      await get().loadBatchList();
      if (get().currentBatch?.id === batchId) {
        set({ currentBatch: null, currentStats: null });
      }
      get().pushToast("success", `批次 ${batch.batchNo} 已撤销，数据已清除`);
      return true;
    } catch (e) {
      const error = e as Error;
      operationLog = updateLogStatus(operationLog, "failed", "database_error", error.message);
      saveOperationLog(operationLog);
      get().pushToast("error", `撤销失败: ${error.message}`);
      return false;
    }
  },

  reimportBatch: async (originalBatchId: string, newBatchNo: string, note?: string) => {
    const original = await getFullBatch(originalBatchId);
    if (!original) {
      get().pushToast("error", "原始批次不存在");
      return null;
    }

    const existing = await batchExistsByNo(newBatchNo);
    if (existing) {
      get().pushToast("error", `新批次编号 ${newBatchNo} 已存在`);
      return null;
    }

    const sourceName = original.parseMetadata?.sourceName || original.batchNo;
    const sourceType = original.parseMetadata?.sourceType || "csv";
    const timeConfig = original.parseMetadata?.timeConfig || { preset: "auto" };
    let operationLog = createOperationLog(sourceName, sourceType, timeConfig, original.parseMetadata?.hasBOM);
    operationLog = updateLogStatus(operationLog, "importing");
    operationLog.batchNo = newBatchNo;

    try {
      operationLog = addAdoptedRule(
        operationLog,
        "reimport",
        `从批次 ${original.batchNo} 撤销后重新导入，保持原始值、标准化时间、采用规则一致`,
        original.dataPoints.length
      );

      const rule = await getRuleVersion(original.ruleVersionId);
      if (!rule) {
        throw new Error("原始批次的规则版本不存在");
      }

      const anomalies = detectAnomalies(original.dataPoints, rule);
      const newBatch: Batch = {
        id: generateId("batch"),
        batchNo: newBatchNo,
        ruleVersionId: original.ruleVersionId,
        importedAt: new Date().toISOString(),
        note: note || original.note,
        totalRows: original.totalRows,
        status: "reviewing",
        dataPoints: original.dataPoints.map((dp) => ({
          ...dp,
          id: `dp_${generateId("reimp")}_${dp.id.split("_").pop()}`,
        })),
        anomalies: anomalies.map((a) => ({
          ...a,
          id: `a_${generateId("reimp")}_${a.id.split("_").pop()}`,
        })),
        decisions: [],
        rollbackLogs: [],
        parseMetadata: original.parseMetadata,
      };

      await saveBatchWithData(newBatch);
      await get().loadBatchList();

      operationLog = updateLogStatus(operationLog, "completed");
      operationLog.recordCounts = {
        totalRows: original.totalRows,
        validRows: original.dataPoints.length,
        invalidRows: 0,
        skippedRows: 0,
        importedRows: original.dataPoints.length,
      };
      saveOperationLog(operationLog);

      const conflictCount = original.parseMetadata?.conflicts?.length || 0;
      const conflictMsg = conflictCount > 0 ? `，保留 ${conflictCount} 条时间解析冲突记录` : "";
      get().pushToast("success", `重导成功，新批次 ${newBatchNo}，${original.dataPoints.length} 条记录${conflictMsg}`);

      const stats = computeStatistics(newBatch.anomalies, newBatch.decisions);
      set({ currentBatch: newBatch, currentStats: stats });
      return newBatch;
    } catch (e) {
      const error = e as Error;
      const category = categorizeImportError(error);
      operationLog = updateLogStatus(operationLog, "failed", category, error.message);
      saveOperationLog(operationLog);
      get().pushToast("error", `重导失败: ${error.message}`);
      throw e;
    }
  },

  checkBatchExists: async (batchNo) => batchExistsByNo(batchNo),

  addDecision: async (batchId, anomalyId, label, comment) => {
    const { currentBatch } = get();
    if (!currentBatch || currentBatch.id !== batchId) return;

    const decision: ReviewDecision = {
      id: generateId("dec"),
      anomalyId,
      label,
      reviewedAt: new Date().toISOString(),
      comment,
    };

    const savedDecision = await saveReviewDecision(batchId, decision);

    const newDecisions = [...currentBatch.decisions, savedDecision];

    const newBatch = { ...currentBatch, decisions: newDecisions };
    const stats = computeStatistics(newBatch.anomalies, newBatch.decisions);
    set({ currentBatch: newBatch, currentStats: stats });
  },

  batchAddDecision: async (batchId, anomalyIds, label) => {
    const { currentBatch } = get();
    if (!currentBatch || currentBatch.id !== batchId) return;

    const now = new Date().toISOString();
    const newDecisions = [...currentBatch.decisions];

    for (const anomalyId of anomalyIds) {
      const decision: ReviewDecision = {
        id: generateId("dec"),
        anomalyId,
        label,
        reviewedAt: now,
      };
      const savedDecision = await saveReviewDecision(batchId, decision);
      newDecisions.push(savedDecision);
    }

    const newBatch = { ...currentBatch, decisions: newDecisions };
    const stats = computeStatistics(newBatch.anomalies, newBatch.decisions);
    set({ currentBatch: newBatch, currentStats: stats });
    get().pushToast("success", `已批量标记 ${anomalyIds.length} 条异常`);
  },

  clearCurrentBatch: () => {
    set({ currentBatch: null, currentStats: null });
  },

  rollbackBatch: async (batchId, toRuleVersionId, reason, reDetect = true) => {
    const batch = await getFullBatch(batchId);
    if (!batch) {
      get().pushToast("error", "批次不存在");
      return;
    }
    if (batch.rollbackLogs.length === 0 && batch.status === "completed") {
      get().pushToast("warning", "该批次已完成，标注将被保留，仅规则版本回退");
    }
    if (toRuleVersionId === batch.ruleVersionId) {
      get().pushToast("error", "目标版本与当前版本相同，无需回滚");
      return;
    }

    const targetRule = await getRuleVersion(toRuleVersionId);
    if (!targetRule) {
      get().pushToast("error", "目标规则版本不存在");
      return;
    }

    const log: RollbackLog = {
      id: generateId("rb"),
      fromRuleVersionId: batch.ruleVersionId,
      toRuleVersionId,
      rolledBackAt: new Date().toISOString(),
      reason,
    };

    let newAnomalies = batch.anomalies;
    let updatedDecisions = batch.decisions;
    if (reDetect) {
      const oldAnomalies = batch.anomalies;
      newAnomalies = detectAnomalies(batch.dataPoints, targetRule);

      const remapResult = remapDecisionsAfterReDetect(oldAnomalies, newAnomalies, batch.decisions);
      updatedDecisions = remapResult.decisions;

      await db.transaction("rw", db.anomalies, db.reviewDecisions, async () => {
        await db.anomalies.where("batchId").equals(batchId).delete();
        const toSave = newAnomalies.map((a) => ({ ...a, batchId }));
        if (toSave.length > 0) await db.anomalies.bulkPut(toSave);

        for (const d of remapResult.decisions) {
          await db.reviewDecisions.update(d.id, {
            anomalyId: d.anomalyId,
            anomalyFingerprint: (d as { anomalyFingerprint?: string }).anomalyFingerprint,
          });
        }
      });

      if (remapResult.remappedCount > 0) {
        get().pushToast("info", `已恢复 ${remapResult.remappedCount} 条复核记录与新异常的关联`);
      }
    }

    const updated: Batch = {
      ...batch,
      ruleVersionId: toRuleVersionId,
      status: "rolled_back",
      anomalies: newAnomalies,
      decisions: updatedDecisions,
      rollbackLogs: [...batch.rollbackLogs, log],
    };

    await db.batches.update(batchId, {
      ruleVersionId: toRuleVersionId,
      status: "rolled_back",
      rollbackLogs: updated.rollbackLogs,
    });

    await get().loadBatchList();
    const stats = computeStatistics(updated.anomalies, updated.decisions);
    set({ currentBatch: updated, currentStats: stats });
    get().pushToast("success", `已回滚到规则 v${targetRule.version}`);
  },

  pushToast: (type, message) => {
    const id = generateId("t");
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => get().removeToast(id), 3500);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

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
