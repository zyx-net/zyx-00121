import "fake-indexeddb/auto";
import { db, saveReviewDecision, saveBatchWithData, getFullBatch, saveRuleVersion, getRuleVersion } from "../src/db/database";
import { generateAnomalyFingerprint, remapDecisionsAfterReDetect } from "../src/utils/anomalyFingerprint";
import { detectAnomalies } from "../src/utils/anomalyDetector";
import { computeStatistics } from "../src/utils/statistics";
import { exportReportCSV } from "../src/utils/reportExporter";
import type { Batch, ReviewDecision, ReviewLabel, RuleVersion, DataPoint, Anomaly } from "../src/types";
import { REVIEW_LABEL_META } from "../src/types";
import { generateId } from "../src/utils/statistics";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`❌ ${msg}`);
  }
  console.log(`  ✅ ${msg}`);
}

async function runAllTests() {
  console.log("\n" + "=".repeat(70));
  console.log("  专项回归测试：回滚重检后复核记录一致性");
  console.log("  Bug：先复核，再回滚重检 → 完成率掉 0，标签全丢");
  console.log("  根因：异常ID随机生成，回滚重检未映射旧决策到新异常");
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
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // 测试 1：指纹稳定性 - 相同内容的异常每次生成指纹相同
  // ---------------------------------------------------------------------------
  await runTest("指纹稳定性：相同异常内容生成相同指纹", () => {
    const anomaly: Anomaly = {
      id: "an_old_1",
      type: "out_of_range",
      sensorName: "Temperature_A1",
      timestamp: "2026-06-19 10:00:00",
      value: 150,
      expectedValue: 70,
      description: "值越界",
    };

    const fp1 = generateAnomalyFingerprint(anomaly);
    const fp2 = generateAnomalyFingerprint(anomaly);
    assert(fp1 === fp2, "同一条异常生成相同指纹");
    assert(fp1.startsWith("fp_"), "指纹以 fp_ 开头");

    const anomaly2: Anomaly = {
      id: "an_new_999",
      type: "out_of_range",
      sensorName: "Temperature_A1",
      timestamp: "2026-06-19 10:00:00",
      value: 150,
      description: "不同描述但核心内容相同",
    };
    const fp3 = generateAnomalyFingerprint(anomaly2);
    assert(fp1 === fp3, "描述不同但核心内容（type/sensor/timestamp/value）相同 → 指纹相同");

    const anomalyDiff: Anomaly = {
      id: "an_diff",
      type: "out_of_range",
      sensorName: "Temperature_A1",
      timestamp: "2026-06-19 10:00:01",
      value: 150,
      description: "",
    };
    const fp4 = generateAnomalyFingerprint(anomalyDiff);
    assert(fp1 !== fp4, "时间戳不同 → 指纹不同");
  });

  // ---------------------------------------------------------------------------
  // 测试 2：remapDecisionsAfterReDetect 核心映射逻辑
  // ---------------------------------------------------------------------------
  await runTest("remapDecisionsAfterReDetect：通过指纹映射旧决策到新异常", () => {
    const oldAnomalies: Anomaly[] = [
      {
        id: "an_old_1",
        type: "out_of_range",
        sensorName: "T1",
        timestamp: "2026-06-19 10:00:00",
        value: 150,
        description: "",
        fingerprint: "fp_abc123",
      },
      {
        id: "an_old_2",
        type: "jump",
        sensorName: "P1",
        timestamp: "2026-06-19 10:00:05",
        value: 10,
        previousValue: 2,
        description: "",
        fingerprint: "fp_def456",
      },
    ];

    const newAnomalies: Anomaly[] = [
      {
        id: "an_new_X",
        type: "out_of_range",
        sensorName: "T1",
        timestamp: "2026-06-19 10:00:00",
        value: 150,
        description: "",
        fingerprint: "fp_abc123",
      },
      {
        id: "an_new_Y",
        type: "jump",
        sensorName: "P1",
        timestamp: "2026-06-19 10:00:05",
        value: 10,
        previousValue: 2,
        description: "",
        fingerprint: "fp_def456",
      },
    ];

    const decisions = [
      { id: "dec_1", anomalyId: "an_old_1", label: "confirmed_fault" as ReviewLabel, reviewedAt: new Date().toISOString() },
      { id: "dec_2", anomalyId: "an_old_2", label: "false_positive" as ReviewLabel, reviewedAt: new Date().toISOString() },
    ];

    const result = remapDecisionsAfterReDetect(oldAnomalies, newAnomalies, decisions);
    assert(result.remappedCount === 2, "2 条决策被重新映射");
    assert(result.decisions[0].anomalyId === "an_new_X", "dec_1 映射到新的 an_new_X");
    assert(result.decisions[1].anomalyId === "an_new_Y", "dec_2 映射到新的 an_new_Y");
  });

  // ---------------------------------------------------------------------------
  // 测试 3：决策已有 anomalyFingerprint 时可独立映射
  // ---------------------------------------------------------------------------
  await runTest("决策自带 anomalyFingerprint 时，不需要 oldAnomalies 也能映射", () => {
    const newAnomalies: Anomaly[] = [
      {
        id: "an_new_A",
        type: "missing",
        sensorName: "V1",
        timestamp: "2026-06-19 10:01:00",
        value: null,
        description: "",
        fingerprint: "fp_ghi789",
      },
    ];

    const decisions = [
      {
        id: "dec_3",
        anomalyId: "an_DELETED_123",
        anomalyFingerprint: "fp_ghi789",
        label: "ignored" as ReviewLabel,
        reviewedAt: new Date().toISOString(),
      },
    ];

    const result = remapDecisionsAfterReDetect([], newAnomalies, decisions);
    assert(result.remappedCount === 1, "1 条决策通过 anomalyFingerprint 独立映射");
    assert(result.decisions[0].anomalyId === "an_new_A", "映射到正确的新异常 ID");
  });

  // ---------------------------------------------------------------------------
  // 测试 4：detectAnomalies 现在为每个异常生成稳定 fingerprint
  // ---------------------------------------------------------------------------
  await runTest("detectAnomalies：现在为每个异常生成 fingerprint", async () => {
    await db.delete();
    await db.open();

    const rule: RuleVersion = {
      id: "rv_test1",
      name: "test",
      version: 1,
      createdAt: new Date().toISOString(),
      description: "",
      devices: [],
      sensorRules: [
        { id: "sr1", deviceId: "d1", sensorName: "T1", minValue: 0, maxValue: 100, jumpThreshold: 50, unit: "C" },
      ],
      missingRules: [],
    };

    const data: DataPoint[] = [
      { id: "dp1", timestamp: "2026-06-19 10:00:00", sensorName: "T1", value: 150 },
      { id: "dp2", timestamp: "2026-06-19 10:01:00", sensorName: "T1", value: 10 },
    ];

    const anomalies1 = detectAnomalies(data, rule);
    assert(anomalies1.length >= 1, "至少检测到 1 个越界异常");
    assert(anomalies1[0].fingerprint !== undefined, "第 1 个异常有 fingerprint");
    assert(anomalies1[0].fingerprint!.startsWith("fp_"), "fingerprint 以 fp_ 开头");

    const anomalies2 = detectAnomalies(data, rule);
    assert(anomalies2[0].fingerprint === anomalies1[0].fingerprint, "两次检测，相同数据点生成相同 fingerprint");
    assert(anomalies2[0].id !== anomalies1[0].id, "但异常 ID 是随机的（不同）");
  });

  // ---------------------------------------------------------------------------
  // 测试 5：完整链路 - 复核后回滚重检，统计不掉、标签不丢
  // ---------------------------------------------------------------------------
  await runTest("完整链路：复核后回滚重检，完成率不掉 0，标签保留", async () => {
    await db.delete();
    await db.open();

    const rule: RuleVersion = {
      id: "rv_rollback",
      name: "回滚测试规则",
      version: 1,
      createdAt: new Date().toISOString(),
      description: "",
      devices: [],
      sensorRules: [
        { id: "sr1", deviceId: "d1", sensorName: "Temperature_A1", minValue: 0, maxValue: 100, jumpThreshold: 50, unit: "C" },
        { id: "sr2", deviceId: "d1", sensorName: "Pressure_B2", minValue: 0, maxValue: 10, jumpThreshold: 5, unit: "bar" },
      ],
      missingRules: [],
    };
    await saveRuleVersion(rule);

    const data: DataPoint[] = [
      { id: "dp1", timestamp: "2026-06-19 10:00:00", sensorName: "Temperature_A1", value: 25 },
      { id: "dp2", timestamp: "2026-06-19 10:01:00", sensorName: "Temperature_A1", value: 150 },
      { id: "dp3", timestamp: "2026-06-19 10:02:00", sensorName: "Pressure_B2", value: 5 },
      { id: "dp4", timestamp: "2026-06-19 10:03:00", sensorName: "Pressure_B2", value: 20 },
    ];

    const anomalies = detectAnomalies(data, rule);
    console.log(`   检测到 ${anomalies.length} 个异常`);
    assert(anomalies.length >= 2, "至少检测到 2 个异常（越界+跳变）");

    const batch: Batch = {
      id: "batch_rb_test",
      batchNo: "RB-TEST-001",
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "回滚测试批次",
      totalRows: data.length,
      status: "reviewing",
      dataPoints: data,
      anomalies,
      decisions: [],
      rollbackLogs: [],
    };
    await saveBatchWithData(batch);

    console.log("   阶段 1: 标记前 2 个异常");
    const dec1 = await saveReviewDecision(batch.id, {
      id: generateId("dec"),
      anomalyId: anomalies[0].id,
      label: "confirmed_fault",
      reviewedAt: new Date().toISOString(),
      comment: "这是一个真实故障",
    });
    const dec2 = await saveReviewDecision(batch.id, {
      id: generateId("dec"),
      anomalyId: anomalies[1].id,
      label: "false_positive",
      reviewedAt: new Date().toISOString(),
    });
    assert(dec1.anomalyFingerprint !== undefined, "dec1 保存了 anomalyFingerprint");
    assert(dec2.anomalyFingerprint !== undefined, "dec2 保存了 anomalyFingerprint");

    const batchBefore = await getFullBatch(batch.id);
    assert(batchBefore!.decisions.length >= 2, "DB 中至少有 2 条决策");
    const statsBefore = computeStatistics(batchBefore!.anomalies, batchBefore!.decisions);
    console.log(`   回滚前：总数=${statsBefore.totalAnomalies}, 确认故障=${statsBefore.byLabel.confirmed_fault}, 误报=${statsBefore.byLabel.false_positive}, 完成率=${(statsBefore.completionRate * 100).toFixed(0)}%`);
    assert(statsBefore.byLabel.confirmed_fault === 1, "回滚前确认故障 = 1");
    assert(statsBefore.byLabel.false_positive === 1, "回滚前误报 = 1");
    assert(statsBefore.completionRate > 0, "回滚前完成率 > 0");

    console.log("   阶段 2: 回滚重检（模拟回滚到相同规则，但会重新生成异常 ID）");
    const reloadedBatch = await getFullBatch(batch.id);
    const oldAnomalies = reloadedBatch!.anomalies;
    const oldDecisions = reloadedBatch!.decisions;

    const newAnomalies = detectAnomalies(data, rule);
    console.log(`   重检后新异常数量: ${newAnomalies.length}`);

    const remapResult = remapDecisionsAfterReDetect(oldAnomalies, newAnomalies, oldDecisions);
    console.log(`   映射了 ${remapResult.remappedCount} 条决策`);
    assert(remapResult.remappedCount >= 2, "至少 2 条决策被成功映射");

    const statsAfter = computeStatistics(newAnomalies, remapResult.decisions as ReviewDecision[]);
    console.log(`   回滚后：总数=${statsAfter.totalAnomalies}, 确认故障=${statsAfter.byLabel.confirmed_fault}, 误报=${statsAfter.byLabel.false_positive}, 完成率=${(statsAfter.completionRate * 100).toFixed(0)}%`);

    assert(statsAfter.byLabel.confirmed_fault === statsBefore.byLabel.confirmed_fault, "回滚后确认故障数不变");
    assert(statsAfter.byLabel.false_positive === statsBefore.byLabel.false_positive, "回滚后误报数不变");
    assert(statsAfter.completionRate === statsBefore.completionRate, "回滚后完成率不变（没有掉到 0！）");
    assert(statsAfter.totalAnomalies === statsBefore.totalAnomalies, "回滚前后异常总数相同");
  });

  // ---------------------------------------------------------------------------
  // 测试 6：导出报告在回滚重检后标签不丢失
  // ---------------------------------------------------------------------------
  await runTest("导出报告：回滚重检后导出的异常标签完整保留", async () => {
    await db.delete();
    await db.open();

    const rule: RuleVersion = {
      id: "rv_export_test",
      name: "导出测试规则",
      version: 1,
      createdAt: new Date().toISOString(),
      description: "",
      devices: [],
      sensorRules: [
        { id: "sr1", deviceId: "d1", sensorName: "T1", minValue: 0, maxValue: 100, jumpThreshold: 50, unit: "C" },
      ],
      missingRules: [],
    };
    await saveRuleVersion(rule);

    const data: DataPoint[] = [
      { id: "dp1", timestamp: "2026-06-19 10:00:00", sensorName: "T1", value: 150 },
      { id: "dp2", timestamp: "2026-06-19 10:01:00", sensorName: "T1", value: 200 },
    ];

    const anomalies1 = detectAnomalies(data, rule);
    assert(anomalies1.length === 2, "检测到 2 个越界异常");

    const batch: Batch = {
      id: "batch_export_rb",
      batchNo: "EXP-RB-001",
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "",
      totalRows: data.length,
      status: "reviewing",
      dataPoints: data,
      anomalies: anomalies1,
      decisions: [],
      rollbackLogs: [],
    };
    await saveBatchWithData(batch);

    await saveReviewDecision(batch.id, {
      id: generateId("dec"),
      anomalyId: anomalies1[0].id,
      label: "confirmed_fault",
      reviewedAt: new Date().toISOString(),
    });
    await saveReviewDecision(batch.id, {
      id: generateId("dec"),
      anomalyId: anomalies1[1].id,
      label: "false_positive",
      reviewedAt: new Date().toISOString(),
    });

    const beforeBatch = await getFullBatch(batch.id);
    const statsBefore = computeStatistics(beforeBatch!.anomalies, beforeBatch!.decisions);
    const csvBefore = exportReportCSV(beforeBatch!, rule, statsBefore);
    assert(csvBefore.includes("确认故障"), "回滚前导出包含确认故障");
    assert(csvBefore.includes("误报"), "回滚前导出包含误报");

    console.log("   阶段 2: 回滚重检（生成全新异常 ID）");
    const anomalies2 = detectAnomalies(data, rule);
    assert(anomalies2[0].id !== anomalies1[0].id, "新异常 ID 不同");

    const remapResult = remapDecisionsAfterReDetect(anomalies1, anomalies2, beforeBatch!.decisions);
    assert(remapResult.remappedCount === 2, "2 条决策都被映射");

    const batchAfter: Batch = {
      ...beforeBatch!,
      anomalies: anomalies2,
      decisions: remapResult.decisions as ReviewDecision[],
    };
    const statsAfter = computeStatistics(anomalies2, remapResult.decisions as ReviewDecision[]);
    const csvAfter = exportReportCSV(batchAfter, rule, statsAfter);

    assert(csvAfter.includes("确认故障"), "回滚后导出仍包含确认故障（没有丢失！）");
    assert(csvAfter.includes("误报"), "回滚后导出仍包含误报（没有丢失！）");
    assert(statsAfter.completionRate === statsBefore.completionRate, "导出统计的完成率一致");
  });

  // ---------------------------------------------------------------------------
  // 测试 7：模拟重启后的读取一致性
  // ---------------------------------------------------------------------------
  await runTest("重启一致性：回滚重检后关闭 DB，重新打开读取仍一致", async () => {
    await db.delete();
    await db.open();

    const rule: RuleVersion = {
      id: "rv_restart_test",
      name: "重启测试规则",
      version: 1,
      createdAt: new Date().toISOString(),
      description: "",
      devices: [],
      sensorRules: [
        { id: "sr1", deviceId: "d1", sensorName: "T1", minValue: 0, maxValue: 100, jumpThreshold: 50, unit: "C" },
      ],
      missingRules: [],
    };
    await saveRuleVersion(rule);

    const data: DataPoint[] = [
      { id: "dp1", timestamp: "2026-06-19 10:00:00", sensorName: "T1", value: 150 },
    ];

    const anomalies1 = detectAnomalies(data, rule);
    const batch: Batch = {
      id: "batch_restart",
      batchNo: "RESTART-001",
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "",
      totalRows: data.length,
      status: "reviewing",
      dataPoints: data,
      anomalies: anomalies1,
      decisions: [],
      rollbackLogs: [],
    };
    await saveBatchWithData(batch);

    await saveReviewDecision(batch.id, {
      id: generateId("dec"),
      anomalyId: anomalies1[0].id,
      label: "confirmed_fault",
      reviewedAt: new Date().toISOString(),
    });

    console.log("   阶段 2: 回滚重检并保存（模拟真实 rollbackBatch 操作）");
    const beforeBatch = await getFullBatch(batch.id);
    const anomalies2 = detectAnomalies(data, rule);
    const remapResult = remapDecisionsAfterReDetect(beforeBatch!.anomalies, anomalies2, beforeBatch!.decisions);

    await db.transaction("rw", db.anomalies, db.reviewDecisions, async () => {
      await db.anomalies.where("batchId").equals(batch.id).delete();
      const toSave = anomalies2.map(a => ({ ...a, batchId: batch.id }));
      await db.anomalies.bulkPut(toSave);
      for (const d of remapResult.decisions) {
        await db.reviewDecisions.update(d.id, {
          anomalyId: d.anomalyId,
          anomalyFingerprint: (d as { anomalyFingerprint?: string }).anomalyFingerprint,
        });
      }
    });

    const statsBeforeClose = computeStatistics(anomalies2, remapResult.decisions as ReviewDecision[]);
    console.log(`   关 DB 前：确认故障=${statsBeforeClose.byLabel.confirmed_fault}, 完成率=${(statsBeforeClose.completionRate * 100).toFixed(0)}%`);

    console.log("   阶段 3: 模拟重启 - 关闭 DB 连接，重新打开");
    db.close();
    await db.open();

    const afterRestart = await getFullBatch(batch.id);
    assert(afterRestart !== undefined, "重启后批次仍存在");
    const statsAfterRestart = computeStatistics(afterRestart!.anomalies, afterRestart!.decisions);
    console.log(`   重启后：确认故障=${statsAfterRestart.byLabel.confirmed_fault}, 完成率=${(statsAfterRestart.completionRate * 100).toFixed(0)}%`);

    assert(statsAfterRestart.byLabel.confirmed_fault === statsBeforeClose.byLabel.confirmed_fault, "重启后确认故障数一致");
    assert(statsAfterRestart.completionRate === statsBeforeClose.completionRate, "重启后完成率一致（不是 0！）");
    assert(statsAfterRestart.totalAnomalies === statsBeforeClose.totalAnomalies, "重启后异常总数一致");
  });

  // ---------------------------------------------------------------------------
  // 测试 8：saveReviewDecision 自动记录 anomalyFingerprint
  // ---------------------------------------------------------------------------
  await runTest("saveReviewDecision：自动从 anomaly 表读取并记录 fingerprint", async () => {
    await db.delete();
    await db.open();

    const rule: RuleVersion = {
      id: "rv_fp_test",
      name: "fp测试",
      version: 1,
      createdAt: new Date().toISOString(),
      description: "",
      devices: [],
      sensorRules: [
        { id: "sr1", deviceId: "d1", sensorName: "T1", minValue: 0, maxValue: 100, jumpThreshold: 50, unit: "C" },
      ],
      missingRules: [],
    };

    const data: DataPoint[] = [
      { id: "dp1", timestamp: "2026-06-19 10:00:00", sensorName: "T1", value: 150 },
    ];

    const anomalies = detectAnomalies(data, rule);
    const batch: Batch = {
      id: "batch_fp_save",
      batchNo: "FP-SAVE-001",
      ruleVersionId: rule.id,
      importedAt: new Date().toISOString(),
      note: "",
      totalRows: 1,
      status: "reviewing",
      dataPoints: data,
      anomalies,
      decisions: [],
      rollbackLogs: [],
    };
    await saveBatchWithData(batch);

    const decision = await saveReviewDecision(batch.id, {
      id: generateId("dec"),
      anomalyId: anomalies[0].id,
      label: "ignored",
      reviewedAt: new Date().toISOString(),
    });

    assert(decision.anomalyFingerprint !== undefined, "返回的决策有 anomalyFingerprint");
    assert(decision.anomalyFingerprint === anomalies[0].fingerprint, "fingerprint 与异常表中一致");

    const saved = await db.reviewDecisions.where("id").equals(decision.id).first();
    assert(saved!.anomalyFingerprint === anomalies[0].fingerprint, "DB 中持久化了 fingerprint");
  });

  // ---------------------------------------------------------------------------
  // 测试 9：旧数据兼容 - 无 fingerprint 的历史数据也能正确映射
  // ---------------------------------------------------------------------------
  await runTest("旧数据兼容：历史数据无 fingerprint 也能通过内容生成指纹映射", () => {
    const oldAnomaliesNoFp: Anomaly[] = [
      {
        id: "an_old_nofp",
        type: "out_of_range",
        sensorName: "T1",
        timestamp: "2026-06-19 10:00:00",
        value: 999,
        description: "这是旧数据，没有 fingerprint 字段",
      },
    ];

    const newAnomaliesWithFp: Anomaly[] = [
      {
        id: "an_newwww",
        type: "out_of_range",
        sensorName: "T1",
        timestamp: "2026-06-19 10:00:00",
        value: 999,
        description: "新检测出的，有 fingerprint",
        fingerprint: generateAnomalyFingerprint(oldAnomaliesNoFp[0]),
      },
    ];

    const decisions = [
      { id: "dec_old", anomalyId: "an_old_nofp", label: "confirmed_fault" as ReviewLabel, reviewedAt: new Date().toISOString() },
    ];

    const result = remapDecisionsAfterReDetect(oldAnomaliesNoFp, newAnomaliesWithFp, decisions);
    assert(result.remappedCount === 1, "即使旧数据没有 fingerprint 字段，也能通过内容生成指纹完成映射");
    assert(result.decisions[0].anomalyId === "an_newwww", "正确映射到新异常 ID");
  });

  // ---------------------------------------------------------------------------
  // 总结
  // ---------------------------------------------------------------------------
  console.log("\n" + "=".repeat(70));
  if (passCount === totalCount) {
    console.log(`🎉 全部 ${totalCount} 个测试通过！`);
    console.log("=".repeat(70));
    console.log("\n✅ 修复验证总结：");
    console.log("   1. Anomaly 新增 fingerprint 字段：基于 type/sensor/timestamp/value/previousValue/nextValue");
    console.log("   2. detectAnomalies 现在为每个异常生成稳定 fingerprint");
    console.log("   3. saveReviewDecision 自动记录 anomalyFingerprint 到决策表");
    console.log("   4. rollbackBatch 重检后通过 fingerprint 映射旧决策到新异常 ID");
    console.log("   5. getFullBatch 加载时也做 fingerprint 动态映射，兼容旧数据");
    console.log("   6. 回滚后完成率保持不变，不会掉到 0");
    console.log("   7. 回滚后导出报告标签完整保留");
    console.log("   8. 重启后读取结果与回滚后完全一致");
    console.log("   9. 旧数据（无 fingerprint）兼容，通过内容生成指纹映射");
    console.log("\n🐛 已修复的 Bug：");
    console.log("   - 回滚重检后完成率掉到 0");
    console.log("   - 回滚后导出的异常列表标签全部丢失");
    console.log("   - 回滚后重启读取结果不一致");
    console.log("   - 复核记录与异常对象之间没有稳定身份映射");
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
