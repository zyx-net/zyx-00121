import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Download,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type { Anomaly, AnomalyType, DataPoint, ReviewLabel } from "@/types";
import { ANOMALY_TYPE_META, REVIEW_LABEL_META } from "@/types";
import { AnomalyBadge, ReviewBadge, StatusBadge } from "@/components/Badge";
import { StatCard } from "@/components/StatCard";
import { StatsCharts } from "@/components/StatsCharts";
import { AnomalyChart } from "@/components/AnomalyChart";
import { formatNumber, formatTimestamp } from "@/utils/statistics";
import {
  downloadFile,
  exportReportCSV,
  generateReportFilename,
} from "@/utils/reportExporter";
import { getRuleVersion } from "@/db/database";

export default function Review() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const {
    currentBatch,
    currentStats,
    loadBatch,
    initStore,
    addDecision,
    batchAddDecision,
    ruleVersions,
    pushToast,
    loading,
  } = useAppStore();

  const [filterType, setFilterType] = useState<AnomalyType | "all">("all");
  const [filterLabel, setFilterLabel] = useState<ReviewLabel | "unreviewed" | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [ruleName, setRuleName] = useState<string>("");

  useEffect(() => {
    initStore();
  }, [initStore]);

  useEffect(() => {
    if (batchId) {
      loadBatch(batchId);
    }
  }, [batchId, loadBatch]);

  useEffect(() => {
    if (currentBatch) {
      getRuleVersion(currentBatch.ruleVersionId).then((r) => {
        if (r) setRuleName(`${r.name} v${r.version}`);
      });
    }
  }, [currentBatch]);

  const batch = currentBatch;
  const stats = currentStats;

  const decisionMap = useMemo(() => {
    const m = new Map<string, ReviewLabel>();
    batch?.decisions.forEach((d) => m.set(d.anomalyId, d.label));
    return m;
  }, [batch]);

  const filteredAnomalies = useMemo(() => {
    if (!batch) return [];
    return batch.anomalies.filter((a) => {
      if (filterType !== "all" && a.type !== filterType) return false;
      const label = decisionMap.get(a.id) ?? "unreviewed";
      if (filterLabel !== "all" && label !== filterLabel) return false;
      return true;
    });
  }, [batch, filterType, filterLabel, decisionMap]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAllVisible = () => {
    if (selectedIds.size === filteredAnomalies.length && filteredAnomalies.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAnomalies.map((a) => a.id)));
    }
  };

  const handleLabel = async (anomalyId: string, label: ReviewLabel) => {
    if (!batch) return;
    await addDecision(batch.id, anomalyId, label);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(anomalyId);
      return next;
    });
  };

  const handleBatchLabel = async (label: ReviewLabel) => {
    if (!batch || selectedIds.size === 0) {
      pushToast("warning", "请先勾选要批量标记的异常");
      return;
    }
    await batchAddDecision(batch.id, Array.from(selectedIds), label);
    setSelectedIds(new Set());
  };

  const handleExport = async () => {
    if (!batch || !stats) return;
    const rule = await getRuleVersion(batch.ruleVersionId);
    if (!rule) return;
    const csv = exportReportCSV(batch, rule, stats);
    downloadFile(csv, generateReportFilename(batch.batchNo), "text/csv;charset=utf-8");
    pushToast("success", "报告已导出");
  };

  if (loading && !batch) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-industrial-400 text-sm">加载批次数据中...</div>
      </div>
    );
  }

  if (!batch || !stats) {
    return (
      <div className="card p-10 text-center">
        <AlertTriangle size={40} className="mx-auto text-industrial-300 mb-3" />
        <p className="text-industrial-500">未找到该批次</p>
        <button
          onClick={() => navigate("/history")}
          className="btn-secondary mt-4 text-xs"
        >
          <ChevronLeft size={14} /> 返回历史记录
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="btn-ghost !p-1.5"
              title="返回"
            >
              <ChevronLeft size={18} />
            </button>
            <h1 className="text-xl font-bold text-industrial-900 flex items-center gap-2">
              <ClipboardCheck size={22} className="text-purple-500" />
              异常复核
            </h1>
          </div>
          <p className="mt-1 text-sm text-industrial-500 ml-10">
            批次{" "}
            <span className="font-mono font-semibold text-industrial-700">
              {batch.batchNo}
            </span>{" "}
            · {ruleName} · 导入于 {formatTimestamp(batch.importedAt)}
          </p>
          {batch.note && (
            <p className="mt-1 text-xs text-industrial-400 ml-10">备注: {batch.note}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={batch.status} />
          <button
            onClick={() => navigate(`/report/${batch.id}`)}
            className="btn-secondary text-xs"
          >
            <BarChart3 size={14} /> 查看报告
          </button>
          <button onClick={handleExport} className="btn-primary text-xs">
            <Download size={14} /> 导出 CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="异常总数"
          value={stats.totalAnomalies}
          icon={AlertTriangle}
          color="orange"
        />
        <StatCard
          label="确认故障"
          value={stats.byLabel.confirmed_fault}
          icon={XCircle}
          color="red"
        />
        <StatCard
          label="误报"
          value={stats.byLabel.false_positive}
          icon={CheckCircle2}
          color="green"
        />
        <StatCard
          label="忽略"
          value={stats.byLabel.ignored}
          icon={MinusCircle}
          color="gray"
        />
        <StatCard
          label="完成率"
          value={`${formatNumber(stats.completionRate)}%`}
          icon={ClipboardCheck}
          color="blue"
          subText={`未复核 ${stats.byLabel.unreviewed} 条`}
        />
      </div>

      <StatsCharts stats={stats} />

      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-industrial-600 flex items-center gap-1">
              <Filter size={14} /> 筛选:
            </span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as AnomalyType | "all")}
              className="input !py-1.5 text-xs !w-auto"
            >
              <option value="all">全部异常类型</option>
              {(Object.keys(ANOMALY_TYPE_META) as AnomalyType[]).map((t) => (
                <option key={t} value={t}>
                  {ANOMALY_TYPE_META[t].name} ({stats.byType[t]})
                </option>
              ))}
            </select>
            <select
              value={filterLabel}
              onChange={(e) =>
                setFilterLabel(e.target.value as ReviewLabel | "unreviewed" | "all")
              }
              className="input !py-1.5 text-xs !w-auto"
            >
              <option value="all">全部复核状态</option>
              <option value="unreviewed">未复核 ({stats.byLabel.unreviewed})</option>
              <option value="confirmed_fault">
                确认故障 ({stats.byLabel.confirmed_fault})
              </option>
              <option value="false_positive">误报 ({stats.byLabel.false_positive})</option>
              <option value="ignored">忽略 ({stats.byLabel.ignored})</option>
            </select>
            <span className="text-xs text-industrial-400">
              显示 {filteredAnomalies.length} / {batch.anomalies.length} 条
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {selectedIds.size > 0 && (
              <span className="text-xs text-industrial-500 mr-1">
                已选 {selectedIds.size} 条
              </span>
            )}
            <button
              onClick={() => handleBatchLabel("confirmed_fault")}
              disabled={selectedIds.size === 0}
              className="btn-danger text-xs !py-1.5"
            >
              <XCircle size={13} /> 批量确认故障
            </button>
            <button
              onClick={() => handleBatchLabel("false_positive")}
              disabled={selectedIds.size === 0}
              className="btn-secondary text-xs !py-1.5 border-green-300 text-green-700 hover:bg-green-50"
            >
              <CheckCircle2 size={13} /> 批量误报
            </button>
            <button
              onClick={() => handleBatchLabel("ignored")}
              disabled={selectedIds.size === 0}
              className="btn-secondary text-xs !py-1.5"
            >
              <MinusCircle size={13} /> 批量忽略
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-industrial-200">
          <table className="w-full text-sm">
            <thead className="bg-industrial-50 sticky top-0">
              <tr className="text-industrial-600 text-xs">
                <th className="w-10 py-2.5 px-2 text-left">
                  <input
                    type="checkbox"
                    checked={
                      filteredAnomalies.length > 0 &&
                      selectedIds.size === filteredAnomalies.length
                    }
                    onChange={selectAllVisible}
                    className="rounded"
                  />
                </th>
                <th className="w-12 py-2.5 px-2 text-left font-medium">#</th>
                <th className="py-2.5 px-2 text-left font-medium">异常类型</th>
                <th className="py-2.5 px-2 text-left font-medium">传感器</th>
                <th className="py-2.5 px-2 text-left font-medium">时间戳</th>
                <th className="py-2.5 px-2 text-right font-medium">当前值</th>
                <th className="py-2.5 px-2 text-left font-medium">描述</th>
                <th className="py-2.5 px-2 text-left font-medium">复核状态</th>
                <th className="py-2.5 px-2 text-center font-medium">操作</th>
                <th className="w-10 py-2.5 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredAnomalies.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="py-12 text-center text-industrial-400 text-sm"
                  >
                    暂无符合条件的异常
                  </td>
                </tr>
              )}
              {filteredAnomalies.map((a, idx) => (
                <AnomalyRow
                  key={a.id}
                  anomaly={a}
                  index={idx + 1}
                  label={decisionMap.get(a.id) ?? "unreviewed"}
                  isSelected={selectedIds.has(a.id)}
                  isExpanded={expandedId === a.id}
                  onToggleSelect={() => toggleSelect(a.id)}
                  onToggleExpand={() =>
                    setExpandedId(expandedId === a.id ? null : a.id)
                  }
                  onLabel={(l) => handleLabel(a.id, l)}
                  dataPoints={batch.dataPoints}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  anomaly: Anomaly;
  index: number;
  label: ReviewLabel | "unreviewed";
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onLabel: (l: ReviewLabel) => void;
  dataPoints: DataPoint[];
}

function AnomalyRow({
  anomaly,
  index,
  label,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onLabel,
  dataPoints,
}: RowProps) {
  return (
    <>
      <tr
        className={`border-t border-industrial-100 transition-colors ${
          isSelected ? "bg-primary-50/60" : "hover:bg-industrial-50"
        }`}
      >
        <td className="py-2.5 px-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="rounded"
          />
        </td>
        <td className="py-2.5 px-2 text-xs font-mono text-industrial-400">{index}</td>
        <td className="py-2.5 px-2">
          <AnomalyBadge type={anomaly.type} />
        </td>
        <td className="py-2.5 px-2 font-mono text-xs text-industrial-700">
          {anomaly.sensorName}
        </td>
        <td className="py-2.5 px-2 text-xs text-industrial-600 font-mono">
          {formatTimestamp(anomaly.timestamp)}
        </td>
        <td className="py-2.5 px-2 text-right font-mono text-xs text-industrial-800">
          {anomaly.value === null ? "-" : anomaly.value.toFixed(3)}
        </td>
        <td className="py-2.5 px-2 text-xs text-industrial-600 max-w-sm truncate">
          {anomaly.description}
        </td>
        <td className="py-2.5 px-2">
          <ReviewBadge label={label} />
        </td>
        <td className="py-2.5 px-2">
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={() => onLabel("confirmed_fault")}
              title="确认故障"
              className={`w-7 h-7 rounded-md flex items-center justify-center transition ${
                label === "confirmed_fault"
                  ? "bg-red-500 text-white shadow"
                  : "text-red-500 hover:bg-red-50"
              }`}
            >
              <XCircle size={15} />
            </button>
            <button
              onClick={() => onLabel("false_positive")}
              title="误报"
              className={`w-7 h-7 rounded-md flex items-center justify-center transition ${
                label === "false_positive"
                  ? "bg-green-500 text-white shadow"
                  : "text-green-500 hover:bg-green-50"
              }`}
            >
              <CheckCircle2 size={15} />
            </button>
            <button
              onClick={() => onLabel("ignored")}
              title="忽略"
              className={`w-7 h-7 rounded-md flex items-center justify-center transition ${
                label === "ignored"
                  ? "bg-slate-500 text-white shadow"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <MinusCircle size={15} />
            </button>
          </div>
        </td>
        <td className="py-2.5 px-2">
          <button
            onClick={onToggleExpand}
            className="w-7 h-7 rounded-md flex items-center justify-center text-industrial-400 hover:text-industrial-700 hover:bg-industrial-100 transition"
          >
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-industrial-50/70 border-t border-industrial-100">
          <td colSpan={10} className="p-4 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h5 className="text-xs font-semibold text-industrial-600 mb-2 uppercase tracking-wide">
                  异常详情
                </h5>
                <div className="space-y-1.5 text-xs text-industrial-700 bg-white p-3 rounded-lg border border-industrial-200">
                  <DetailRow label="异常编号" value={anomaly.id} />
                  <DetailRow label="异常类型" value={ANOMALY_TYPE_META[anomaly.type].name} />
                  <DetailRow label="传感器" value={anomaly.sensorName} />
                  <DetailRow label="时间" value={formatTimestamp(anomaly.timestamp)} />
                  <DetailRow
                    label="当前值"
                    value={anomaly.value === null ? "-" : anomaly.value.toFixed(3)}
                  />
                  {anomaly.previousValue !== undefined && (
                    <DetailRow
                      label="前一值"
                      value={anomaly.previousValue.toFixed(3)}
                    />
                  )}
                  {anomaly.nextValue !== undefined && (
                    <DetailRow
                      label="后一值"
                      value={anomaly.nextValue.toFixed(3)}
                    />
                  )}
                  {anomaly.expectedValue !== undefined && (
                    <DetailRow
                      label="期望值"
                      value={anomaly.expectedValue.toFixed(3)}
                    />
                  )}
                  <DetailRow label="描述" value={anomaly.description} />
                </div>
              </div>
              <div>
                <h5 className="text-xs font-semibold text-industrial-600 mb-2 uppercase tracking-wide">
                  上下文数据 (前后各 20 点)
                </h5>
                <div className="bg-white rounded-lg border border-industrial-200 p-2">
                  <AnomalyChart dataPoints={dataPoints} anomaly={anomaly} />
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 text-industrial-500 shrink-0">{label}</span>
      <span className="font-mono break-all">{value}</span>
    </div>
  );
}
