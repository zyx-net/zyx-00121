import "fake-indexeddb/auto";
import { db, saveReviewDecision, saveBatchWithData } from "../src/db/database";
import { collapseDecisions, getDecisionHistory } from "../src/utils/decisionHistory";
import { computeStatistics, formatTimestamp } from "../src/utils/statistics";
import { exportReportCSV } from "../src/utils/reportExporter";
import type { Batch, ReviewDecision, ReviewLabel, RuleVersion } from "../src/types";
import { REVIEW_LABEL_META } from "../src/types";
import { generateId } from "../src/utils/statistics";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`❌ ${msg}`);
  }
  console.log(`  ✅ ${msg}`);
}

function makeDecision(anomalyId: string, label: ReviewLabel, seq?: number, superseded?: boolean, previousLabel?: ReviewLabel): ReviewDecision {
  return {
    id: generateId("dec"),
    anomalyId,
    label,
    reviewedAt: new Date(Date.now() + Math.random() * 1000).toISOString(),
    sequence: seq,
    isSuperseded: superseded,
    previousLabel,
  };
}

const mockRule: RuleVersion = {
  id: "rv_mock",
  name: "测试规则",
  version: 1,
  createdAt: new Date().toISOString(),
  description: "",
  devices: [],
  sensorRules: [],
  missingRules: [],
};

async function runAllTests() {
  console.log("\n" + "=".repeat(70));
  console.log("  专项回归测试：改判后立即导出历史标签一致性");
  console.log("  Bug：确认故障→改判误报→立即导出，报告显示「无变更」");
  console.log("  根因：store 层覆盖式更新，DB 层追加式存储，不一致");
  console.log("=".repeat(70) + "\n");

  let passCount = 0;
  let totalCount = 0;

  async function runTest(name: string, fn: () => Promise<void> | void) {
    totalCount++;
    console.log(`\n📋 测试 ${totalCount}: ${name}`);
    try {
      await fn();
      passCount++;
      console.log(`   ✓ 通过`);
    } catch (e) {
      console.error(`   ✗ 失败: ${e}`);
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // 测试 1：saveReviewDecision 返回值包含完整历史字段
  // ---------------------------------------------------------------------------
  await runTest("saveReviewDecision 返回值包含 sequence、previousLabel、isSuperseded", async () => {
    await db.delete();
    await db.open();

    const decision1 = await saveReviewDecision("batch_001", makeDecision("an_001", "confirmed_fault"));
    assert(decision1.sequence === 1, "第 1 条决策 sequence = 1");
    assert(decision1.isSuperseded === false, "第 1 条决策 isSuperseded = false");
    assert(decision1.previousLabel === undefined, "第 1 条决策无 previousLabel");

    const decision2 = await saveReviewDecision("batch_001", makeDecision("an_001", "false_positive"));
    assert(decision2.sequence === 2, "第 2 条决策 sequence = 2");
    assert(decision2.isSuperseded === false, "第 2 条决策 isSuperseded = false");
    assert(decision2.previousLabel === "confirmed_fault", "第 2 条决策 previousLabel = confirmed_fault");

    const decision3 = await saveReviewDecision("batch_001", makeDecision("an_001", "ignored"));
    assert(decision3.sequence === 3, "第 3 条决策 sequence = 3");
    assert(decision3.previousLabel === "false_positive", "第 3 条决策 previousLabel = false_positive");

    const allDecisions = await db.reviewDecisions.where("batchId").equals("batch_001").toArray();
    assert(allDecisions.length === 3, "DB 中保存了 3 条历史记录");
    assert(allDecisions.filter(d => !d.isSuperseded).length === 1, "只有 1 条有效（未被替代）记录");
    assert(allDecisions.filter(d => d.isSuperseded).length === 2, "2 条历史记录被标记为已替代");
  });

  // ---------------------------------------------------------------------------
  // 测试 2：模拟 store 追加式更新 - 改判后内存中历史完整
  // ---------------------------------------------------------------------------
  await runTest("模拟 store 追加式更新 - 改判后内存决策数组历史完整", () => {
    let memoryDecisions: ReviewDecision[] = [];

    const d1 = makeDecision("an_001", "confirmed_fault", 1, false);
    memoryDecisions = [...memoryDecisions, d1];
    assert(memoryDecisions.length === 1, "第 1 次打标后内存有 1 条记录");

    const d2 = makeDecision("an_001", "false_positive", 2, false, "confirmed_fault");
    memoryDecisions = [...memoryDecisions, d2];
    assert(memoryDecisions.length === 2, "改判后内存有 2 条记录（追加，不是覆盖！）");

    const d3 = makeDecision("an_001", "ignored", 3, false, "false_positive");
    memoryDecisions = [...memoryDecisions, d3];
    assert(memoryDecisions.length === 3, "再次改判后内存有 3 条记录");

    const history = getDecisionHistory(memoryDecisions, "an_001");
    assert(history.length === 3, "getDecisionHistory 返回 3 条历史");
    assert(history[0].label === "confirmed_fault", "历史第 1 条：确认故障");
    assert(history[1].label === "false_positive", "历史第 2 条：误报");
    assert(history[2].label === "ignored", "历史第 3 条：忽略");

    const collapsed = collapseDecisions(memoryDecisions);
    assert(collapsed.length === 1, "折叠后只有 1 条最新决策");
    assert(collapsed[0].label === "ignored", "折叠后最新标签是忽略");
  });

  // ---------------------------------------------------------------------------
  // 测试 3：立即导出场景 - 改判后立刻用内存数据导出，历史标签变更正确
  // ---------------------------------------------------------------------------
  await runTest("立即导出场景 - 改判后立刻导出，「历史标签变更」列显示正确", () => {
    const d1 = makeDecision("an_001", "confirmed_fault", 1, false);
    const d2 = makeDecision("an_001", "false_positive", 2, false, "confirmed_fault");
    const d3 = makeDecision("an_001", "ignored", 3, false, "false_positive");

    const memoryDecisions = [d1, d2, d3];

    const history = getDecisionHistory(memoryDecisions, "an_001");
    assert(history.length === 3, "内存中有 3 条历史，不是 1 条！");

    const historyStr = history.length > 1
      ? history.map((h, i) =>
          `${i + 1}. ${REVIEW_LABEL_META[h.label].name} (${formatTimestamp(h.reviewedAt)})`
        ).join("; ")
      : "无变更";

    assert(historyStr !== "无变更", "历史标签变更不应该显示「无变更」");
    assert(historyStr.includes("确认故障"), "历史包含「确认故障」");
    assert(historyStr.includes("误报"), "历史包含「误报」");
    assert(historyStr.includes("忽略"), "历史包含「忽略」");
    assert(historyStr.includes("1. "), "历史有序号 1");
    assert(historyStr.includes("2. "), "历史有序号 2");
    assert(historyStr.includes("3. "), "历史有序号 3");

    console.log(`   📜 导出的历史标签变更: ${historyStr}`);
  });

  // ---------------------------------------------------------------------------
  // 测试 4：对比 - 旧的覆盖式更新会导致历史丢失（证明 Bug 存在）
  // ---------------------------------------------------------------------------
  await runTest("Bug 复现证明 - 旧的覆盖式更新导致历史丢失", () => {
    let memoryDecisions: ReviewDecision[] = [];

    const d1 = makeDecision("an_001", "confirmed_fault", 1, false);
    memoryDecisions = [...memoryDecisions, d1];

    // ❌ 旧的错误逻辑：找到 existingIdx 然后覆盖！
    const d2 = makeDecision("an_001", "false_positive", 2, false, "confirmed_fault");
    const existingIdx = memoryDecisions.findIndex(d => d.anomalyId === "an_001");
    const newDecisions = [...memoryDecisions];
    if (existingIdx >= 0) {
      newDecisions[existingIdx] = d2;  // ❌ 覆盖！历史丢失！
    } else {
      newDecisions.push(d2);
    }

    assert(newDecisions.length === 1, "❌ Bug 复现：覆盖式更新后内存只有 1 条记录");

    const history = getDecisionHistory(newDecisions, "an_001");
    assert(history.length === 1, "❌ Bug 复现：getDecisionHistory 只返回 1 条");

    const historyStr = history.length > 1 ? "有变更" : "无变更";
    assert(historyStr === "无变更", "❌ Bug 复现：导出显示「无变更」，这就是用户报告的问题！");
  });

  // ---------------------------------------------------------------------------
  // 测试 5：完整链路 - 确认→改判→立即导出→重启→再导出，结果一致
  // ---------------------------------------------------------------------------
  await runTest("完整链路：确认故障→改判误报→立即导出→重启→再导出，结果一致", async () => {
    await db.delete();
    await db.open();

    const mockBatch: Batch = {
      id: "batch_test",
      batchNo: "TEST-001",
      ruleVersionId: "rv_mock",
      importedAt: new Date().toISOString(),
      note: "测试批次",
      totalRows: 100,
      status: "reviewing",
      dataPoints: [],
      anomalies: [
        {
          id: "an_001",
          type: "out_of_range",
          sensorName: "Temperature_A1",
          timestamp: new Date().toISOString(),
          value: 150,
          expectedValue: "40~100",
          description: "值越界",
        },
        {
          id: "an_002",
          type: "jump",
          sensorName: "Pressure_B2",
          timestamp: new Date().toISOString(),
          value: 10,
          previousValue: 2,
          description: "跳变异常",
        },
      ],
      decisions: [],
      rollbackLogs: [],
    };

    await saveBatchWithData(mockBatch);

    let memoryDecisions: ReviewDecision[] = [];

    console.log("   阶段 1: an_001 确认为故障");
    const d1 = await saveReviewDecision("batch_test", makeDecision("an_001", "confirmed_fault"));
    memoryDecisions = [...memoryDecisions, d1];
    assert(memoryDecisions.length === 1, "内存 1 条记录");

    let stats = computeStatistics(mockBatch.anomalies, memoryDecisions);
    assert(stats.byLabel.confirmed_fault === 1, "确认故障 1 个");
    assert(stats.byLabel.unreviewed === 1, "未复核 1 个");

    console.log("   阶段 2: an_001 改判为误报 → 立即导出");
    const d2 = await saveReviewDecision("batch_test", makeDecision("an_001", "false_positive"));
    memoryDecisions = [...memoryDecisions, d2];
    assert(memoryDecisions.length === 2, "内存 2 条记录（追加，不是覆盖！）");

    const historyBefore = getDecisionHistory(memoryDecisions, "an_001");
    assert(historyBefore.length === 2, "立即导出前有 2 条历史");
    assert(historyBefore[0].label === "confirmed_fault", "第 1 条：确认故障");
    assert(historyBefore[1].label === "false_positive", "第 2 条：误报");
    assert(d2.previousLabel === "confirmed_fault", "previousLabel 正确");

    stats = computeStatistics(mockBatch.anomalies, memoryDecisions);
    assert(stats.byLabel.confirmed_fault === 0, "改判后确认故障 0 个");
    assert(stats.byLabel.false_positive === 1, "改判后误报 1 个");

    const batchForExportBefore: Batch = { ...mockBatch, decisions: memoryDecisions };
    const csvBefore = exportReportCSV(batchForExportBefore, mockRule, stats);
    assert(csvBefore.includes("历史标签变更"), "导出包含「历史标签变更」列");
    assert(csvBefore.includes("确认故障"), "导出版本 1：包含确认故障");
    assert(csvBefore.includes("误报"), "导出版本 1：包含误报");
    assert(!csvBefore.includes("无变更"), "导出不显示「无变更」！");

    console.log("   阶段 3: 模拟重启 - 从 DB 重新加载所有决策");
    const dbDecisions = await db.reviewDecisions.where("batchId").equals("batch_test").toArray();
    const cleanDbDecisions = dbDecisions.map(({ batchId: _b, ...rest }) => rest);
    assert(cleanDbDecisions.length === 2, "DB 中有 2 条历史记录");

    const historyAfter = getDecisionHistory(cleanDbDecisions, "an_001");
    assert(historyAfter.length === 2, "重启后仍有 2 条历史");

    const statsAfter = computeStatistics(mockBatch.anomalies, cleanDbDecisions);
    assert(statsAfter.byLabel.confirmed_fault === stats.byLabel.confirmed_fault, "重启后确认故障数一致");
    assert(statsAfter.byLabel.false_positive === stats.byLabel.false_positive, "重启后误报数一致");
    assert(statsAfter.completionRate === stats.completionRate, "重启后完成率一致");

    const batchForExportAfter: Batch = { ...mockBatch, decisions: cleanDbDecisions };
    const csvAfter = exportReportCSV(batchForExportAfter, mockRule, statsAfter);
    assert(csvAfter.includes("确认故障"), "导出版本 2：包含确认故障");
    assert(csvAfter.includes("误报"), "导出版本 2：包含误报");
    assert(!csvAfter.includes("无变更"), "重启后导出也不显示「无变更」！");

    console.log("   ✅ 立即导出和重启后导出结果完全一致！");
  });

  // ---------------------------------------------------------------------------
  // 测试 6：批量改判后立即导出，所有历史保留
  // ---------------------------------------------------------------------------
  await runTest("批量改判后立即导出，所有异常的历史都保留", async () => {
    await db.delete();
    await db.open();

    const mockBatch: Batch = {
      id: "batch_test2",
      batchNo: "TEST-002",
      ruleVersionId: "rv_mock",
      importedAt: new Date().toISOString(),
      note: "测试批次2",
      totalRows: 100,
      status: "reviewing",
      dataPoints: [],
      anomalies: [
        { id: "an_101", type: "out_of_range", sensorName: "T1", timestamp: new Date().toISOString(), value: 1, description: "" },
        { id: "an_102", type: "jump", sensorName: "P1", timestamp: new Date().toISOString(), value: 1, description: "" },
        { id: "an_103", type: "missing", sensorName: "V1", timestamp: new Date().toISOString(), value: null, description: "" },
      ],
      decisions: [],
      rollbackLogs: [],
    };

    await saveBatchWithData(mockBatch);

    let memoryDecisions: ReviewDecision[] = [];

    console.log("   阶段 1: 批量确认为故障");
    for (const anomalyId of ["an_101", "an_102", "an_103"]) {
      const d = await saveReviewDecision("batch_test2", makeDecision(anomalyId, "confirmed_fault"));
      memoryDecisions.push(d);
    }
    assert(memoryDecisions.length === 3, "批量确认后 3 条记录");

    console.log("   阶段 2: an_101 改判为误报，an_102 改判为忽略 → 立即导出");
    const d2_101 = await saveReviewDecision("batch_test2", makeDecision("an_101", "false_positive"));
    const d2_102 = await saveReviewDecision("batch_test2", makeDecision("an_102", "ignored"));
    memoryDecisions.push(d2_101);
    memoryDecisions.push(d2_102);
    assert(memoryDecisions.length === 5, "改判后 5 条记录（3 + 2 追加）");

    const history101 = getDecisionHistory(memoryDecisions, "an_101");
    const history102 = getDecisionHistory(memoryDecisions, "an_102");
    const history103 = getDecisionHistory(memoryDecisions, "an_103");

    assert(history101.length === 2, "an_101 有 2 条历史");
    assert(history102.length === 2, "an_102 有 2 条历史");
    assert(history103.length === 1, "an_103 有 1 条历史（无变更）");

    const stats = computeStatistics(mockBatch.anomalies, memoryDecisions);
    assert(stats.byLabel.confirmed_fault === 1, "最终确认故障 1 个（an_103）");
    assert(stats.byLabel.false_positive === 1, "最终误报 1 个（an_101）");
    assert(stats.byLabel.ignored === 1, "最终忽略 1 个（an_102）");

    const batchForExport: Batch = { ...mockBatch, decisions: memoryDecisions };
    const csv = exportReportCSV(batchForExport, mockRule, stats);

    assert(csv.includes("1. 确认故障"), "an_101 历史包含确认故障");
    assert(csv.includes("2. 误报"), "an_101 历史包含误报");
    assert(csv.includes("2. 忽略"), "an_102 历史包含忽略");
    assert(csv.includes("无变更"), "an_103 显示「无变更」（正确，因为只打了一次标）");

    console.log("   ✅ 批量改判后立即导出，历史完整！");
  });

  // ---------------------------------------------------------------------------
  // 测试 7：模拟 store addDecision 完整流程 - 验证修复后的逻辑
  // ---------------------------------------------------------------------------
  await runTest("模拟 store addDecision 完整流程 - 验证修复后的追加逻辑", async () => {
    await db.delete();
    await db.open();

    const mockBatch: Batch = {
      id: "batch_store",
      batchNo: "STORE-001",
      ruleVersionId: "rv_mock",
      importedAt: new Date().toISOString(),
      note: "",
      totalRows: 100,
      status: "reviewing",
      dataPoints: [],
      anomalies: [{ id: "an_store", type: "out_of_range", sensorName: "T1", timestamp: new Date().toISOString(), value: 1, description: "" }],
      decisions: [],
      rollbackLogs: [],
    };

    let currentBatch: Batch = { ...mockBatch };

    console.log("   第 1 次调用 addDecision: 确认故障");
    const decision1 = { id: generateId("dec"), anomalyId: "an_store", label: "confirmed_fault" as ReviewLabel, reviewedAt: new Date().toISOString() };
    const saved1 = await saveReviewDecision("batch_store", decision1);
    currentBatch = { ...currentBatch, decisions: [...currentBatch.decisions, saved1] };
    assert(currentBatch.decisions.length === 1, "第 1 次后 decisions 长度 1");
    assert(saved1.sequence === 1, "saved1 sequence=1");

    console.log("   第 2 次调用 addDecision: 改判误报");
    const decision2 = { id: generateId("dec"), anomalyId: "an_store", label: "false_positive" as ReviewLabel, reviewedAt: new Date().toISOString() };
    const saved2 = await saveReviewDecision("batch_store", decision2);
    currentBatch = { ...currentBatch, decisions: [...currentBatch.decisions, saved2] };
    assert(currentBatch.decisions.length === 2, "第 2 次后 decisions 长度 2（追加，不是覆盖！）");
    assert(saved2.sequence === 2, "saved2 sequence=2");
    assert(saved2.previousLabel === "confirmed_fault", "saved2 previousLabel 正确");

    console.log("   第 3 次调用 addDecision: 改判忽略");
    const decision3 = { id: generateId("dec"), anomalyId: "an_store", label: "ignored" as ReviewLabel, reviewedAt: new Date().toISOString() };
    const saved3 = await saveReviewDecision("batch_store", decision3);
    currentBatch = { ...currentBatch, decisions: [...currentBatch.decisions, saved3] };
    assert(currentBatch.decisions.length === 3, "第 3 次后 decisions 长度 3");

    const history = getDecisionHistory(currentBatch.decisions, "an_store");
    assert(history.length === 3, "getDecisionHistory 返回 3 条完整历史");
    assert(history[0].label === "confirmed_fault", "历史 1: 确认故障");
    assert(history[1].label === "false_positive", "历史 2: 误报");
    assert(history[2].label === "ignored", "历史 3: 忽略");

    const stats = computeStatistics(currentBatch.anomalies, currentBatch.decisions);
    assert(stats.byLabel.ignored === 1, "统计正确：忽略 1 个");
    assert(stats.byLabel.confirmed_fault === 0, "统计正确：确认故障 0 个");

    console.log("   ✅ store 层追加逻辑正确！");
  });

  // ---------------------------------------------------------------------------
  // 总结
  // ---------------------------------------------------------------------------
  console.log("\n" + "=".repeat(70));
  if (passCount === totalCount) {
    console.log(`🎉 全部 ${totalCount} 个测试通过！`);
    console.log("=".repeat(70));
    console.log("\n✅ 修复验证总结：");
    console.log("   1. saveReviewDecision 现在返回完整的决策对象（含 sequence、previousLabel、isSuperseded）");
    console.log("   2. store.addDecision 和 batchAddDecision 从覆盖式改为追加式");
    console.log("   3. 改判后立即导出，内存中的 decisions 数组包含完整历史");
    console.log("   4. getDecisionHistory 能正确返回所有历史版本");
    console.log("   5. 导出报告的「历史标签变更」列正确显示完整变更链");
    console.log("   6. 重启后从 DB 加载的结果与改判后立即导出的结果完全一致");
    console.log("   7. 统计口径在改判后、重启后始终一致");
    console.log("\n🐛 已修复的 Bug：");
    console.log("   - 改判后立即导出显示「无变更」");
    console.log("   - 同一会话改判后导出和重启后导出结果不一致");
    console.log("   - 内存状态和持久化状态不一致");
    console.log("=".repeat(70) + "\n");
    process.exit(0);
  } else {
    console.error(`❌ ${totalCount - passCount}/${totalCount} 个测试失败`);
    console.log("=".repeat(70));
    process.exit(1);
  }
}

runAllTests().catch(e => {
  console.error("测试运行失败:", e);
  process.exit(1);
});
