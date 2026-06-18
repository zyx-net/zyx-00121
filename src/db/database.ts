import Dexie, { Table } from "dexie";
import type {
  Batch,
  RuleVersion,
  DataPoint,
  Anomaly,
  ReviewDecision,
} from "@/types";
export { collapseDecisions, getDecisionHistory } from "@/utils/decisionHistory";

export class SensorQADatabase extends Dexie {
  ruleVersions!: Table<RuleVersion, string>;
  batches!: Table<Batch, string>;
  dataPoints!: Table<DataPoint & { batchId: string }, string>;
  anomalies!: Table<Anomaly & { batchId: string }, string>;
  reviewDecisions!: Table<ReviewDecision & { batchId: string }, string>;

  constructor() {
    super("sensor_qa_db");
    this.version(1).stores({
      ruleVersions: "id, version, createdAt",
      batches: "id, batchNo, importedAt, ruleVersionId, status",
      dataPoints: "id, batchId, sensorName, timestamp",
      anomalies: "id, batchId, type, sensorName, timestamp",
      reviewDecisions: "id, batchId, anomalyId, label",
    });
    this.version(2).stores({
      reviewDecisions: "id, batchId, anomalyId, label, reviewedAt, isSuperseded",
    }).upgrade(tx => {
      return tx.table("reviewDecisions").toCollection().modify(dec => {
        if (dec.isSuperseded === undefined) dec.isSuperseded = false;
        if (dec.sequence === undefined) dec.sequence = 1;
      });
    });
  }
}

export const db = new SensorQADatabase();

export async function saveBatchWithData(batch: Batch): Promise<void> {
  await db.transaction("rw", db.batches, db.dataPoints, db.anomalies, db.reviewDecisions, async () => {
    await db.batches.put({
      id: batch.id,
      batchNo: batch.batchNo,
      ruleVersionId: batch.ruleVersionId,
      importedAt: batch.importedAt,
      note: batch.note,
      totalRows: batch.totalRows,
      status: batch.status,
      dataPoints: [],
      anomalies: [],
      decisions: [],
      rollbackLogs: batch.rollbackLogs,
    });

    const dpWithBatch = batch.dataPoints.map((dp) => ({ ...dp, batchId: batch.id }));
    if (dpWithBatch.length > 0) await db.dataPoints.bulkPut(dpWithBatch);

    const anWithBatch = batch.anomalies.map((a) => ({ ...a, batchId: batch.id }));
    if (anWithBatch.length > 0) await db.anomalies.bulkPut(anWithBatch);

    const decWithBatch = batch.decisions.map((d) => ({ ...d, batchId: batch.id }));
    if (decWithBatch.length > 0) await db.reviewDecisions.bulkPut(decWithBatch);
  });
}

export async function getFullBatch(batchId: string): Promise<Batch | undefined> {
  const batchMeta = await db.batches.get(batchId);
  if (!batchMeta) return undefined;

  const [dataPoints, anomalies, decisions] = await Promise.all([
    db.dataPoints.where("batchId").equals(batchId).toArray(),
    db.anomalies.where("batchId").equals(batchId).toArray(),
    db.reviewDecisions.where("batchId").equals(batchId).toArray(),
  ]);

  const cleanDP = dataPoints.map(({ batchId: _b, ...rest }) => rest);
  const cleanAN = anomalies.map(({ batchId: _b, ...rest }) => rest);
  const cleanDEC = decisions.map(({ batchId: _b, ...rest }) => rest);

  return {
    ...batchMeta,
    dataPoints: cleanDP,
    anomalies: cleanAN,
    decisions: cleanDEC,
  };
}

export async function getAllBatchList(): Promise<
  Array<Omit<Batch, "dataPoints" | "anomalies" | "decisions">>
> {
  const batches = await db.batches.orderBy("importedAt").reverse().toArray();
  return batches.map((b) => ({
    id: b.id,
    batchNo: b.batchNo,
    ruleVersionId: b.ruleVersionId,
    importedAt: b.importedAt,
    note: b.note,
    totalRows: b.totalRows,
    status: b.status,
    rollbackLogs: b.rollbackLogs,
  }));
}

export async function saveReviewDecision(
  batchId: string,
  decision: ReviewDecision
): Promise<void> {
  await db.transaction("rw", db.reviewDecisions, async () => {
    const existing = await db.reviewDecisions
      .where("anomalyId")
      .equals(decision.anomalyId)
      .sortBy("sequence");

    const maxSequence = existing.length > 0
      ? Math.max(...existing.map(d => d.sequence ?? 1))
      : 0;

    const previous = existing.find(d => !d.isSuperseded);

    for (const dec of existing) {
      if (!dec.isSuperseded) {
        await db.reviewDecisions.update(dec.id, {
          isSuperseded: true,
        });
      }
    }

    const newDecision: ReviewDecision & { batchId: string } = {
      ...decision,
      previousLabel: previous?.label,
      isSuperseded: false,
      sequence: maxSequence + 1,
      batchId,
    };

    await db.reviewDecisions.put(newDecision);
  });
}



export async function saveRuleVersion(rule: RuleVersion): Promise<void> {
  await db.ruleVersions.put(rule);
}

export async function getAllRuleVersions(): Promise<RuleVersion[]> {
  return db.ruleVersions.orderBy("version").reverse().toArray();
}

export async function getRuleVersion(id: string): Promise<RuleVersion | undefined> {
  return db.ruleVersions.get(id);
}

export async function batchExistsByNo(batchNo: string): Promise<boolean> {
  const count = await db.batches.where("batchNo").equals(batchNo).count();
  return count > 0;
}
