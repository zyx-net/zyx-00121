import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  History,
  ChevronLeft,
  RotateCcw,
  Eye,
  Download,
  Search,
  X,
  AlertTriangle,
  FileText,
  BarChart3,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { StatusBadge } from "@/components/Badge";
import { formatNumber, formatTimestamp } from "@/utils/statistics";
import { getRuleVersion } from "@/db/database";
import type { RuleVersion } from "@/types";
import { buildRollbackTrail, downloadFile, exportReportCSV, generateReportFilename } from "@/utils/reportExporter";
import { computeStatistics } from "@/utils/statistics";

export default function HistoryPage() {
  const navigate = useNavigate();
  const { batchList, initStore, rollbackBatch, ruleVersions, pushToast, loadBatchList } = useAppStore();

  const [search, setSearch] = useState("");
  const [rollbackModal, setRollbackModal] = useState<{ batchId: string; batchNo: string } | null>(null);
  const [targetRuleId, setTargetRuleId] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [reDetect, setReDetect] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);
  const [ruleCache, setRuleCache] = useState<Record<string, RuleVersion>>({});

  useEffect(() => {
    initStore();
  }, [initStore]);

  useEffect(() => {
    (async () => {
      const ids = new Set(batchList.map((b) => b.ruleVersionId));
      const cache: Record<string, RuleVersion> = {};
      for (const id of ids) {
        const r = await getRuleVersion(id);
        if (r) cache[id] = r;
      }
      batchList.forEach((b) => {
        b.rollbackLogs.forEach((log) => {
          ids.add(log.fromRuleVersionId);
          ids.add(log.toRuleVersionId);
        });
      });
      for (const id of ids) {
        if (!cache[id]) {
          const r = await getRuleVersion(id);
          if (r) cache[id] = r;
        }
      }
      setRuleCache(cache);
    })();
  }, [batchList]);

  const filtered = useMemo(() => {
    if (!search.trim()) return batchList;
    const q = search.toLowerCase();
    return batchList.filter(
      (b) =>
        b.batchNo.toLowerCase().includes(q) ||
        b.note.toLowerCase().includes(q) ||
        ruleCache[b.ruleVersionId]?.name.toLowerCase().includes(q)
    );
  }, [batchList, search, ruleCache]);

  const openRollback = (batchId: string, batchNo: string, currentRuleId: string) => {
    setRollbackModal({ batchId, batchNo });
    const others = ruleVersions.filter((r) => r.id !== currentRuleId);
    setTargetRuleId(others[0]?.id ?? "");
    setRollbackReason("");
  };

  const doRollback = async () => {
    if (!rollbackModal || !targetRuleId) return;
    if (!rollbackReason.trim()) {
      pushToast("warning", "请填写回滚原因");
      return;
    }
    setRollingBack(true);
    try {
      await rollbackBatch(rollbackModal.batchId, targetRuleId, rollbackReason.trim(), reDetect);
      await loadBatchList();
      setRollbackModal(null);
    } finally {
      setRollingBack(false);
    }
  };

  const handleExport = async (batchId: string) => {
    const { getFullBatch } = await import("@/db/database");
    const batch = await getFullBatch(batchId);
    if (!batch) {
      pushToast("error", "批次不存在");
      return;
    }
    const rule = await getRuleVersion(batch.ruleVersionId);
    if (!rule) {
      pushToast("error", "规则版本不存在");
      return;
    }
    const stats = computeStatistics(batch.anomalies, batch.decisions);
    const csv = exportReportCSV(batch, rule, stats);
    downloadFile(csv, generateReportFilename(batch.batchNo), "text/csv;charset=utf-8");
    pushToast("success", "报告已导出");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-industrial-900 flex items-center gap-2">
            <History size={22} className="text-industrial-600" />
            历史记录
          </h1>
          <p className="mt-1 text-sm text-industrial-500">
            查看所有数据批次，支持规则版本回滚
          </p>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-industrial-400" />
          <input
            className="input !pl-9 !w-64"
            placeholder="搜索批次号、备注..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText size={44} className="mx-auto text-industrial-300 mb-3" />
          <p className="text-industrial-500">暂无历史批次</p>
          <button
            onClick={() => navigate("/import")}
            className="btn-primary mt-4 text-xs"
          >
            导入第一批数据
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-industrial-50 border-b border-industrial-200">
                <tr className="text-industrial-600 text-xs">
                  <th className="text-left py-3 px-4 font-medium">批次编号</th>
                  <th className="text-left py-3 px-4 font-medium">导入时间</th>
                  <th className="text-left py-3 px-4 font-medium">规则版本</th>
                  <th className="text-right py-3 px-4 font-medium">数据量</th>
                  <th className="text-left py-3 px-4 font-medium">状态</th>
                  <th className="text-left py-3 px-4 font-medium">备注</th>
                  <th className="text-left py-3 px-4 font-medium">回滚痕迹</th>
                  <th className="text-right py-3 px-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const rule = ruleCache[b.ruleVersionId];
                  const trails = buildRollbackTrail(b, Object.values(ruleCache));
                  return (
                    <tr
                      key={b.id}
                      className="border-b border-industrial-100 hover:bg-industrial-50/60 transition"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-industrial-800">
                        {b.batchNo}
                      </td>
                      <td className="py-3 px-4 text-xs text-industrial-600">
                        {formatTimestamp(b.importedAt)}
                      </td>
                      <td className="py-3 px-4">
                        {rule ? (
                          <span className="text-xs font-mono text-industrial-700 bg-primary-50 px-2 py-0.5 rounded">
                            {rule.name} · v{rule.version}
                          </span>
                        ) : (
                          <span className="text-xs text-industrial-400">未知</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-industrial-700">
                        {formatNumber(b.totalRows, 0)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="py-3 px-4 text-xs text-industrial-500 max-w-xs truncate">
                        {b.note || "-"}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {trails.length === 0 ? (
                          <span className="text-industrial-400">-</span>
                        ) : (
                          <div className="max-w-xs">
                            <details className="group">
                              <summary className="cursor-pointer text-orange-600 font-medium hover:text-orange-700">
                                {trails.length} 次回滚
                              </summary>
                              <div className="mt-1 space-y-0.5 text-industrial-600 bg-orange-50/40 rounded p-2">
                                {trails.map((t, i) => (
                                  <p key={i} className="leading-snug">{t}</p>
                                ))}
                              </div>
                            </details>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => navigate(`/review/${b.id}`)}
                            className="btn-ghost !py-1 !px-2 text-xs text-primary-600"
                            title="复核"
                          >
                            <Eye size={14} /> 复核
                          </button>
                          <button
                            onClick={() => navigate(`/report/${b.id}`)}
                            className="btn-ghost !py-1 !px-2 text-xs text-industrial-600"
                            title="报告"
                          >
                            <BarChart3 size={14} /> 报告
                          </button>
                          <button
                            onClick={() => handleExport(b.id)}
                            className="btn-ghost !py-1 !px-2 text-xs text-green-600"
                            title="导出"
                          >
                            <Download size={14} />
                          </button>
                          <button
                            onClick={() =>
                              openRollback(b.id, b.batchNo, b.ruleVersionId)
                            }
                            className="btn-ghost !py-1 !px-2 text-xs text-orange-600"
                            title="回滚"
                            disabled={ruleVersions.length < 2}
                          >
                            <RotateCcw size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rollbackModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md animate-fade-in">
            <div className="flex items-start justify-between p-5 border-b border-industrial-200">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-industrial-800">回滚规则版本</h3>
                  <p className="text-xs text-industrial-500 mt-1">
                    批次 <span className="font-mono">{rollbackModal.batchNo}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRollbackModal(null)}
                className="text-industrial-400 hover:text-industrial-600"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">目标规则版本</label>
                <select
                  value={targetRuleId}
                  onChange={(e) => setTargetRuleId(e.target.value)}
                  className="input"
                >
                  {ruleVersions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · v{r.version} ({formatTimestamp(r.createdAt)})
                    </option>
                  ))}
                </select>
                {ruleVersions.length < 2 && (
                  <p className="text-xs text-red-500 mt-1">
                    至少需要 2 个规则版本才能回滚
                  </p>
                )}
              </div>
              <div>
                <label className="label">回滚原因 *</label>
                <textarea
                  className="input min-h-[80px]"
                  placeholder="请填写回滚原因..."
                  value={rollbackReason}
                  onChange={(e) => setRollbackReason(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-industrial-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reDetect}
                  onChange={(e) => setReDetect(e.target.checked)}
                  className="rounded"
                />
                使用新规则重新检测异常（旧标注将被保留）
              </label>
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                ⚠ 已确认的人工复核标签将被保留，不会被清除
              </div>
            </div>
            <div className="p-4 border-t border-industrial-200 flex justify-end gap-2 bg-industrial-50/50 rounded-b-xl">
              <button
                onClick={() => setRollbackModal(null)}
                className="btn-secondary text-xs"
                disabled={rollingBack}
              >
                取消
              </button>
              <button
                onClick={doRollback}
                className="btn-primary text-xs"
                disabled={rollingBack || !targetRuleId || ruleVersions.length < 2}
              >
                {rollingBack ? (
                  <>
                    <RotateCcw size={14} className="animate-spin" /> 回滚中...
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} /> 确认回滚
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
