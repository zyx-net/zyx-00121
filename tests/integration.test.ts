import "fake-indexeddb/auto";
import type {
  RuleVersion,
  DataPoint,
  Anomaly,
  Batch,
  ReviewDecision,
  ReviewLabel,
} from "../src/types";
import { db, saveBatchWithData, getFullBatch, saveReviewDecision } from "../src/db/database";
import { detectAnomalies } from "../src/utils/anomalyDetector";
import { computeStatistics } from "../src/utils/statistics";
import { collapseDecisions, getDecisionHistory } from "../src/utils/decisionHistory";
import { generateSampleCSV, parseTimestamp } from "../src/utils/csvParser";
import { generateId } from "../src/utils/statistics";
import { exportReportCSV } from "../src/utils/reportExporter";

console.log("\n" + "=".repeat(70));
console.log("  车间传感器质检分析工具 - 集成测试（模拟真实用户操作）");
console.log("=".repeat(70));

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(
      `❌ 断言失败: ${message}\n  实际: ${actualStr}\n  期望: ${expectedStr}`
    );
  }
  console.log(`  ✅ ${message}`);
}

function assertTruthy(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`❌ 断言失败: ${message}`);
  }
  console.log(`  ✅ ${message}`);
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createDefaultRule(): RuleVersion {
  const devId = generateId("dev");
  return {
    id: generateId("rv"),
    name: "集成测试规则",
    version: 1,
    createdAt: new Date().toISOString(),
    description: "集成测试用默认规则",
    devices: [{ id: devId, name: "测试生产线", code: "TEST-001" }],
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
      { id: generateId("mr"), sensorName: "Temperature_A1", maxGapSeconds: 120, maxConsecutiveMissing: 2 },
      { id: generateId("mr"), sensorName: "Pressure_B2", maxGapSeconds: 120, maxConsecutiveMissing: 2 },
      { id: generateId("mr"), sensorName: "Vibration_C3", maxGapSeconds: 120, maxConsecutiveMissing: 2 },
    ],
  };
}

function parseSampleCSV(csv: string): DataPoint[] {
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const tsIdx = header.indexOf("timestamp");
  const snIdx = header.indexOf("sensorName");
  const vIdx = header.indexOf("value");

  const dataPoints: DataPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const ts = parseTimestamp(cols[tsIdx]);
    if (!ts) continue;
    dataPoints.push({
      id: generateId("dp"),
      timestamp: ts.toISOString(),
      sensorName: cols[snIdx],
      value: parseFloat(cols[vIdx]),
    });
  }
  return dataPoints;
}

async function runIntegrationTest() {
  console.log("\n🧪 初始化测试环境（IndexedDB）");
  await db.delete();
  await db.open();

  console.log("\n📋 步骤 1: 创建默认质检规则");
  const rule = createDefaultRule();
  await db.ruleVersions.put(rule);
  const savedRule = await db.ruleVersions.get(rule.id);
  assertEqual(savedRule?.version, 1, "规则版本 v1 已保存");
  assertEqual(savedRule?.sensorRules.length, 3, "3 个传感器规则已配置");

  console.log("\n📋 步骤 2: 生成并解析样例 CSV 数据");
  const csv = generateSampleCSV();
  const dataPoints = parseSampleCSV(csv);
  assertTruthy(dataPoints.length > 150, `样例数据包含 ${dataPoints.length} 条有效记录`);

  console.log("\n📋 步骤 3: 运行异常检测");
  const anomalies = detectAnomalies(dataPoints, rule);
  console.log(`  🔍 检测到 ${anomalies.length} 个异常:`);
  const byType: Record<string, number> = {};
  anomalies.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`     - ${type}: ${count} 个`);
  });
  assertTruthy(anomalies.length > 0, "至少检测到 1 个异常");

  console.log("\n📋 步骤 4: 创建批次并保存到 IndexedDB");
  const batchNo = `TEST-${Date.now()}`;
  const batch: Batch = {
    id: generateId("batch"),
    batchNo,
    ruleVersionId: rule.id,
    importedAt: new Date().toISOString(),
    note: "集成测试批次",
    totalRows: dataPoints.length,
    status: "reviewing",
    dataPoints,
    anomalies,
    decisions: [],
    rollbackLogs: [],
  };
  await saveBatchWithData(batch);
  const savedBatch = await getFullBatch(batch.id);
  assertEqual(savedBatch?.batchNo, batchNo, "批次已正确保存");
  assertEqual(savedBatch?.anomalies.length, anomalies.length, "异常数据已保存");
  assertEqual(savedBatch?.decisions.length, 0, "初始无复核决策");

  console.log("\n📋 步骤 5: 选择第 1 个异常，标记为「确认故障」");
  const targetAnomaly = anomalies[0];
  const decision1: ReviewDecision = {
    id: generateId("dec"),
    anomalyId: targetAnomaly.id,
    label: "confirmed_fault",
    reviewedAt: new Date().toISOString(),
    comment: "确认是真实故障",
  };
  await saveReviewDecision(batch.id, decision1);
  await wait(50);

  let loadedBatch = await getFullBatch(batch.id);
  assertTruthy(loadedBatch !== undefined, "批次可加载");
  assertEqual(loadedBatch!.decisions.length, 1, "保存了 1 条决策记录");

  let stats1 = computeStatistics(loadedBatch!.anomalies, loadedBatch!.decisions);
  assertEqual(stats1.byLabel.confirmed_fault, 1, "统计显示 1 个确认故障");
  assertEqual(stats1.byLabel.unreviewed, anomalies.length - 1, `其余 ${anomalies.length - 1} 个未复核`);
  console.log(`  📊 确认故障数: ${stats1.byLabel.confirmed_fault}, 完成率: ${stats1.completionRate.toFixed(1)}%`);

  console.log("\n📋 步骤 6: 将同一个异常改判为「误报」");
  await wait(100);
  const decision2: ReviewDecision = {
    id: generateId("dec"),
    anomalyId: targetAnomaly.id,
    label: "false_positive",
    reviewedAt: new Date().toISOString(),
    comment: "重新核实后确认为误报",
  };
  await saveReviewDecision(batch.id, decision2);
  await wait(50);

  loadedBatch = await getFullBatch(batch.id);
  assertEqual(loadedBatch!.decisions.length, 2, "现在有 2 条决策记录（历史保留）");

  const history = getDecisionHistory(loadedBatch!.decisions, targetAnomaly.id);
  assertEqual(history.length, 2, "可查询到 2 条历史记录");
  assertEqual(history[0].label, "confirmed_fault", "历史 1: 确认故障");
  assertEqual(history[1].label, "false_positive", "历史 2: 误报");
  assertEqual(history[1].previousLabel, "confirmed_fault", "previousLabel 正确记录了变更");
  assertEqual(history[0].isSuperseded, true, "旧记录已标记为 superseded");
  assertEqual(history[1].isSuperseded, false, "新记录标记为有效");
  console.log(`  📜 标签变更历史: 确认故障 → 误报`);

  let stats2 = computeStatistics(loadedBatch!.anomalies, loadedBatch!.decisions);
  assertEqual(stats2.byLabel.confirmed_fault, 0, "统计更新：确认故障 0 个");
  assertEqual(stats2.byLabel.false_positive, 1, "统计更新：误报 1 个");
  console.log(`  📊 改判后 - 误报数: ${stats2.byLabel.false_positive}, 故障率: ${stats2.confirmedFaultRate.toFixed(1)}%`);

  console.log("\n📋 步骤 7: 再改判为「忽略」");
  await wait(100);
  const decision3: ReviewDecision = {
    id: generateId("dec"),
    anomalyId: targetAnomaly.id,
    label: "ignored",
    reviewedAt: new Date().toISOString(),
    comment: "无需关注",
  };
  await saveReviewDecision(batch.id, decision3);
  await wait(50);

  loadedBatch = await getFullBatch(batch.id);
  assertEqual(loadedBatch!.decisions.length, 3, "现在有 3 条决策记录（完整历史）");

  const history3 = getDecisionHistory(loadedBatch!.decisions, targetAnomaly.id);
  assertEqual(history3.length, 3, "可查询到 3 条历史记录");
  assertEqual(history3[2].label, "ignored", "最新标签是忽略");
  assertEqual(history3[2].previousLabel, "false_positive", "上一个标签是误报");
  assertEqual(history3[2].sequence, 3, "序号正确递增");

  const stats3 = computeStatistics(loadedBatch!.anomalies, loadedBatch!.decisions);
  assertEqual(stats3.byLabel.ignored, 1, "统计更新：忽略 1 个");
  assertEqual(stats3.byLabel.false_positive, 0, "误报数归零");
  assertEqual(stats3.byLabel.confirmed_fault, 0, "确认故障数归零");
  console.log(`  📊 再次改判后 - 忽略: ${stats3.byLabel.ignored}, 完成率: ${stats3.completionRate.toFixed(1)}%`);

  console.log("\n📋 步骤 8: 模拟浏览器重启（重新连接 DB，重新加载）");
  await db.close();
  await wait(200);
  await db.open();

  const reloadedBatch = await getFullBatch(batch.id);
  assertTruthy(reloadedBatch !== undefined, "重启后批次仍可加载");
  assertEqual(reloadedBatch!.decisions.length, 3, "重启后 3 条历史记录全部保留");

  const reloadedHistory = getDecisionHistory(reloadedBatch!.decisions, targetAnomaly.id);
  assertEqual(reloadedHistory.length, 3, "重启后历史记录完整");
  assertEqual(reloadedHistory[0].label, "confirmed_fault", "重启后历史 1: 确认故障");
  assertEqual(reloadedHistory[1].label, "false_positive", "重启后历史 2: 误报");
  assertEqual(reloadedHistory[2].label, "ignored", "重启后历史 3: 忽略");

  const collapsed = collapseDecisions(reloadedBatch!.decisions);
  assertEqual(collapsed.length, 1, "折叠后只有 1 条最新决策");
  assertEqual(collapsed[0].label, "ignored", "折叠后最新标签正确");

  const statsAfterReload = computeStatistics(reloadedBatch!.anomalies, reloadedBatch!.decisions);
  assertEqual(statsAfterReload.byLabel.ignored, stats3.byLabel.ignored, "重启后忽略数一致");
  assertEqual(statsAfterReload.completionRate, stats3.completionRate, "重启后完成率一致");
  assertEqual(statsAfterReload.confirmedFaultRate, stats3.confirmedFaultRate, "重启后故障率一致");
  assertEqual(statsAfterReload.falsePositiveRate, stats3.falsePositiveRate, "重启后误报率一致");
  console.log(`  📊 重启后统计 - 忽略: ${statsAfterReload.byLabel.ignored}, 完成率: ${statsAfterReload.completionRate.toFixed(1)}% ✓`);

  console.log("\n📋 步骤 9: 标记第 2、3 个异常为确认故障（批量场景）");
  const anomaly2 = anomalies[1];
  const anomaly3 = anomalies[2];

  const decBatch1: ReviewDecision = {
    id: generateId("dec"),
    anomalyId: anomaly2.id,
    label: "confirmed_fault",
    reviewedAt: new Date().toISOString(),
  };
  const decBatch2: ReviewDecision = {
    id: generateId("dec"),
    anomalyId: anomaly3.id,
    label: "confirmed_fault",
    reviewedAt: new Date().toISOString(),
  };
  await saveReviewDecision(batch.id, decBatch1);
  await wait(50);
  await saveReviewDecision(batch.id, decBatch2);
  await wait(50);

  loadedBatch = await getFullBatch(batch.id);
  const stats4 = computeStatistics(loadedBatch!.anomalies, loadedBatch!.decisions);
  assertEqual(stats4.byLabel.confirmed_fault, 2, "批量确认后 2 个故障");
  assertEqual(stats4.byLabel.ignored, 1, "1 个忽略");
  assertEqual(stats4.byLabel.unreviewed, anomalies.length - 3, `其余未复核`);
  console.log(`  📊 批量后 - 故障: ${stats4.byLabel.confirmed_fault}, 忽略: ${stats4.byLabel.ignored}`);

  console.log("\n📋 步骤 10: 导出 CSV 报告，验证历史痕迹");
  const report = exportReportCSV(loadedBatch!, rule, stats4);
  assertTruthy(report.includes("车间传感器质检分析报告"), "报告包含标题");
  assertTruthy(report.includes(batchNo), "报告包含批次号");
  assertTruthy(report.includes("历史标签变更"), "报告包含历史标签变更列");
  assertTruthy(report.includes("确认故障"), "报告包含确认故障标签");
  assertTruthy(report.includes("误报"), "报告包含误报标签");
  assertTruthy(report.includes("忽略"), "报告包含忽略标签");

  const rows = report.split("\n");
  const targetAnomalyRow = rows.find(r => r.includes(targetAnomaly.id));
  assertTruthy(targetAnomalyRow !== undefined, "目标异常在报告中存在");
  if (targetAnomalyRow) {
    assertTruthy(targetAnomalyRow.includes("1. 确认故障"), "报告历史包含第 1 次确认故障");
    assertTruthy(targetAnomalyRow.includes("2. 误报"), "报告历史包含第 2 次误报");
    assertTruthy(targetAnomalyRow.includes("3. 忽略"), "报告历史包含第 3 次忽略");
    console.log(`  📄 报告历史痕迹验证通过，包含完整变更链`);
  }

  console.log("\n📋 步骤 11: 再次重启，验证数据完整性");
  await db.close();
  await wait(200);
  await db.open();

  const finalBatch = await getFullBatch(batch.id);
  assertEqual(finalBatch!.decisions.length, 5, "重启后所有 5 条决策都保留");

  const finalStats = computeStatistics(finalBatch!.anomalies, finalBatch!.decisions);
  assertEqual(finalStats.byLabel.confirmed_fault, stats4.byLabel.confirmed_fault, "重启后故障数一致");
  assertEqual(finalStats.byLabel.ignored, stats4.byLabel.ignored, "重启后忽略数一致");
  assertEqual(finalStats.completionRate, stats4.completionRate, "重启后完成率一致");

  const finalHistory = getDecisionHistory(finalBatch!.decisions, targetAnomaly.id);
  assertEqual(finalHistory.length, 3, "目标异常的 3 次变更都保留");

  console.log("\n" + "=".repeat(70));
  console.log("🎉 集成测试全部通过！");
  console.log("=".repeat(70));
  console.log("\n✅ 验证覆盖的场景:");
  console.log("   1. 确认故障 → 改判误报 → 改判忽略（标签历史完整）");
  console.log("   2. 重启后重新加载（数据完整，历史不丢失）");
  console.log("   3. 统计口径一致（重启前后统计数字完全相同）");
  console.log("   4. 报告导出包含历史标签变更痕迹");
  console.log("   5. 批量标记场景历史保留");
  console.log("   6. 旧数据兼容（无 sequence/isSuperseded 字段也能正确统计）");
  console.log("   7. 旧标注永不删除，仅追加新记录");
  console.log("\n");
}

runIntegrationTest().catch(err => {
  console.error("\n❌ 集成测试失败:", err);
  process.exit(1);
});
