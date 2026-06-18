import type {
  ReviewDecision,
  ReviewLabel,
  Anomaly,
  StatisticsSummary,
} from "../src/types";
import { collapseDecisions, getDecisionHistory } from "../src/utils/decisionHistory";
import { computeStatistics, generateId } from "../src/utils/statistics";
import { ANOMALY_TYPE_META, REVIEW_LABEL_META } from "../src/types";
import { formatTimestamp } from "../src/utils/statistics";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`❌ 断言失败: ${message}`);
  }
  console.log(`  ✅ ${message}`);
}

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

function makeDecision(
  anomalyId: string,
  label: ReviewLabel,
  sequence: number,
  isSuperseded = false,
  previousLabel?: ReviewLabel
): ReviewDecision {
  return {
    id: generateId("dec"),
    anomalyId,
    label,
    reviewedAt: new Date(Date.now() - (10 - sequence) * 1000).toISOString(),
    isSuperseded,
    sequence,
    previousLabel,
  };
}

function makeAnomaly(
  id: string,
  type: Anomaly["type"],
  sensorName: string,
  value: number
): Anomaly {
  return {
    id,
    type,
    sensorName,
    timestamp: new Date().toISOString(),
    value,
    description: `测试异常 ${id}`,
  };
}

console.log("\n" + "=".repeat(60));
console.log("  车间传感器质检分析工具 - 回归测试套件");
console.log("=".repeat(60));

console.log("\n📋 测试 1: collapseDecisions - 从历史中提取最新有效决策");
{
  const anomalyId = "an_001";
  const decisions: ReviewDecision[] = [
    makeDecision(anomalyId, "confirmed_fault", 1, true),
    makeDecision(anomalyId, "false_positive", 2, true, "confirmed_fault"),
    makeDecision(anomalyId, "ignored", 3, false, "false_positive"),
  ];

  const collapsed = collapseDecisions(decisions);

  assertEqual(collapsed.length, 1, "只保留 1 条最新决策");
  assertEqual(collapsed[0].label, "ignored", "最新标签是 ignored");
  assertEqual(collapsed[0].isSuperseded, false, "最新决策未被替代");
  assertEqual(collapsed[0].sequence, 3, "序号是 3");
}

console.log("\n📋 测试 2: collapseDecisions - 旧数据兼容（无 sequence/isSuperseded 字段）");
{
  const anomalyId = "an_002";
  const oldStyle: ReviewDecision[] = [
    {
      id: "dec_old_1",
      anomalyId,
      label: "confirmed_fault",
      reviewedAt: new Date(Date.now() - 5000).toISOString(),
    },
  ];

  const collapsed = collapseDecisions(oldStyle);
  assertEqual(collapsed.length, 1, "旧数据也能正确提取");
  assertEqual(collapsed[0].label, "confirmed_fault", "标签正确");
}

console.log("\n📋 测试 3: getDecisionHistory - 获取完整变更历史");
{
  const anomalyId = "an_003";
  const decisions: ReviewDecision[] = [
    makeDecision(anomalyId, "confirmed_fault", 1, true),
    makeDecision(anomalyId, "false_positive", 2, true, "confirmed_fault"),
    makeDecision("an_other", "ignored", 1, false),
  ];

  const history = getDecisionHistory(decisions, anomalyId);
  assertEqual(history.length, 2, "只返回该 anomaly 的 2 条历史");
  assertEqual(history[0].label, "confirmed_fault", "按时间正序，第一条是确认故障");
  assertEqual(history[1].label, "false_positive", "第二条是误报");
  assertEqual(history[1].previousLabel, "confirmed_fault", "previousLabel 正确记录上一个标签");
}

console.log("\n📋 测试 4: computeStatistics - 统计口径使用最新标签");
{
  const anomalies: Anomaly[] = [
    makeAnomaly("an_101", "out_of_range", "Temperature_A1", 150),
    makeAnomaly("an_102", "jump", "Pressure_B2", 10),
    makeAnomaly("an_103", "missing", "Vibration_C3", 0),
    makeAnomaly("an_104", "duplicate_timestamp", "Temperature_A1", 50),
  ];

  const decisions: ReviewDecision[] = [
    makeDecision("an_101", "confirmed_fault", 1, true),
    makeDecision("an_101", "false_positive", 2, false, "confirmed_fault"),
    makeDecision("an_102", "confirmed_fault", 1, false),
  ];

  const stats = computeStatistics(anomalies, decisions);

  assertEqual(stats.totalAnomalies, 4, "异常总数 4");
  assertEqual(stats.byLabel.confirmed_fault, 1, "确认故障 1 个（an_102）");
  assertEqual(stats.byLabel.false_positive, 1, "误报 1 个（an_101 最新标签）");
  assertEqual(stats.byLabel.unreviewed, 2, "未复核 2 个");
  assertEqual(stats.byLabel.ignored, 0, "忽略 0 个");
}

console.log("\n📋 测试 5: 完整链路 - 确认故障 → 改判误报 → 重启加载 → 统计一致");
{
  console.log("  阶段 1: 初始状态 - an_201 未复核");
  const anomalies: Anomaly[] = [
    makeAnomaly("an_201", "out_of_range", "Temperature_A1", 200),
    makeAnomaly("an_202", "jump", "Pressure_B2", 8),
  ];

  let decisions: ReviewDecision[] = [];
  let stats = computeStatistics(anomalies, decisions);
  assertEqual(stats.byLabel.unreviewed, 2, "初始未复核 2 个");

  console.log("  阶段 2: an_201 确认为故障");
  decisions.push(makeDecision("an_201", "confirmed_fault", 1, false));
  stats = computeStatistics(anomalies, decisions);
  assertEqual(stats.byLabel.confirmed_fault, 1, "确认故障 1 个");
  assertEqual(stats.confirmedFaultRate > 0, true, "故障率 > 0");

  console.log("  阶段 3: an_201 改判为误报（追加新记录，旧记录标记 superseded）");
  const oldDec = decisions.find(d => d.anomalyId === "an_201")!;
  decisions = decisions.map(d =>
    d.anomalyId === "an_201" ? { ...d, isSuperseded: true } : d
  );
  decisions.push(
    makeDecision("an_201", "false_positive", 2, false, "confirmed_fault")
  );

  stats = computeStatistics(anomalies, decisions);
  assertEqual(stats.byLabel.confirmed_fault, 0, "确认故障 0 个（改判后）");
  assertEqual(stats.byLabel.false_positive, 1, "误报 1 个");
  assertEqual(stats.falsePositiveRate > 0, true, "误报率 > 0");

  console.log("  阶段 4: 模拟重启 - 从 DB 重新加载所有历史（完整历史保留）");
  const persistedDecisions = [...decisions];
  const reloadedStats = computeStatistics(anomalies, persistedDecisions);

  assertEqual(
    reloadedStats.byLabel.false_positive,
    stats.byLabel.false_positive,
    "重启后误报数一致"
  );
  assertEqual(
    reloadedStats.completionRate,
    stats.completionRate,
    "重启后完成率一致"
  );

  console.log("  阶段 5: 验证历史可追溯");
  const history = getDecisionHistory(persistedDecisions, "an_201");
  assertEqual(history.length, 2, "保留 2 条历史记录");
  assertEqual(history[0].label, "confirmed_fault", "历史 1: 确认故障");
  assertEqual(history[1].label, "false_positive", "历史 2: 误报");
  assertEqual(history[1].previousLabel, "confirmed_fault", "记录了标签变更");
}

console.log("\n📋 测试 6: 批量操作的历史保留");
{
  const anomalies: Anomaly[] = [
    makeAnomaly("an_301", "out_of_range", "Temperature_A1", 200),
    makeAnomaly("an_302", "out_of_range", "Temperature_A1", 210),
    makeAnomaly("an_303", "jump", "Pressure_B2", 9),
  ];

  let decisions: ReviewDecision[] = [];

  console.log("  阶段 1: 批量确认故障");
  for (const id of ["an_301", "an_302", "an_303"]) {
    decisions.push(makeDecision(id, "confirmed_fault", 1, false));
  }
  let stats = computeStatistics(anomalies, decisions);
  assertEqual(stats.byLabel.confirmed_fault, 3, "批量确认后 3 个故障");

  console.log("  阶段 2: an_302 改判为误报，an_303 改判为忽略");
  decisions = decisions.map(d => {
    if (d.anomalyId === "an_302" || d.anomalyId === "an_303") {
      return { ...d, isSuperseded: true };
    }
    return d;
  });
  decisions.push(
    makeDecision("an_302", "false_positive", 2, false, "confirmed_fault")
  );
  decisions.push(
    makeDecision("an_303", "ignored", 2, false, "confirmed_fault")
  );

  stats = computeStatistics(anomalies, decisions);
  assertEqual(stats.byLabel.confirmed_fault, 1, "最终确认故障 1 个");
  assertEqual(stats.byLabel.false_positive, 1, "最终误报 1 个");
  assertEqual(stats.byLabel.ignored, 1, "最终忽略 1 个");

  console.log("  阶段 3: 重启后统计一致");
  const reloadedStats = computeStatistics(anomalies, [...decisions]);
  assertEqual(
    reloadedStats.byLabel.confirmed_fault,
    stats.byLabel.confirmed_fault,
    "重启后确认故障数一致"
  );
  assertEqual(
    reloadedStats.completionRate,
    stats.completionRate,
    "重启后完成率一致"
  );
}

console.log("\n📋 测试 7: 报告导出 - 历史标签变更痕迹");
{
  const anomalies: Anomaly[] = [
    makeAnomaly("an_401", "out_of_range", "Temperature_A1", 200),
  ];

  const decisions: ReviewDecision[] = [
    makeDecision("an_401", "confirmed_fault", 1, true),
    makeDecision("an_401", "false_positive", 2, true, "confirmed_fault"),
    makeDecision("an_401", "ignored", 3, false, "false_positive"),
  ];

  const history = getDecisionHistory(decisions, "an_401");

  console.log("  标签变更历史:");
  history.forEach((h, i) => {
    const prev = h.previousLabel
      ? ` ← ${REVIEW_LABEL_META[h.previousLabel].name}`
      : "";
    console.log(
      `    ${i + 1}. ${REVIEW_LABEL_META[h.label].name}${prev} (${formatTimestamp(h.reviewedAt)})`
    );
  });

  assertEqual(history.length, 3, "3 次变更都被记录");
  assertEqual(history[2].previousLabel, "false_positive", "最后一次变更的前标签是误报");

  const latest = collapseDecisions(decisions)[0];
  assertEqual(latest.label, "ignored", "最新标签是忽略");
  assertEqual(latest.sequence, 3, "最新序号是 3");
}

console.log("\n📋 测试 8: 越界异常的异常类型元数据");
{
  const anomalies: Anomaly[] = [
    makeAnomaly("an_501", "missing", "Temperature_A1", 0),
    makeAnomaly("an_502", "out_of_range", "Temperature_A1", 200),
    makeAnomaly("an_503", "jump", "Pressure_B2", 10),
    makeAnomaly("an_504", "duplicate_timestamp", "Vibration_C3", 1),
  ];

  const decisions: ReviewDecision[] = [
    makeDecision("an_501", "confirmed_fault", 1, false),
    makeDecision("an_502", "confirmed_fault", 1, false),
    makeDecision("an_503", "false_positive", 1, false),
  ];

  const stats = computeStatistics(anomalies, decisions);

  assertEqual(stats.byType.missing, 1, "缺失 1 个");
  assertEqual(stats.byType.out_of_range, 1, "越界 1 个");
  assertEqual(stats.byType.jump, 1, "跳变 1 个");
  assertEqual(stats.byType.duplicate_timestamp, 1, "重复时间戳 1 个");
  assertEqual(stats.bySensor["Temperature_A1"], 2, "Temperature_A1 有 2 个异常");
}

console.log("\n" + "=".repeat(60));
console.log("🎉 所有测试通过！");
console.log("=".repeat(60) + "\n");
