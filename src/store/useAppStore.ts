import { create } from "zustand";
import type {
  Batch,
  ReviewDecision,
  ReviewLabel,
  RuleVersion,
  RollbackLog,
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
    dataPoints: Batch["dataPoints"]
  ) => Promise<Batch>;
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

  createBatch: async (batchNo, note, ruleVersionId, dataPoints) => {
    const rule = await getRuleVersion(ruleVersionId);
    if (!rule) throw new Error("规则版本不存在");

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
    };

    await saveBatchWithData(batch);
    await get().loadBatchList();
    get().pushToast("success", `批次 ${batchNo} 导入成功，检测到 ${anomalies.length} 个异常`);

    const stats = computeStatistics(batch.anomalies, batch.decisions);
    set({ currentBatch: batch, currentStats: stats });
    return batch;
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
    if (reDetect) {
      newAnomalies = detectAnomalies(batch.dataPoints, targetRule);
      await db.anomalies.where("batchId").equals(batchId).delete();
      const toSave = newAnomalies.map((a) => ({ ...a, batchId }));
      if (toSave.length > 0) await db.anomalies.bulkPut(toSave);
    }

    const updated: Batch = {
      ...batch,
      ruleVersionId: toRuleVersionId,
      status: "rolled_back",
      anomalies: newAnomalies,
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
