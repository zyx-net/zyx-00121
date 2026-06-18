import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import {
  FileBarChart2,
  ChevronLeft,
  Download,
  Printer,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type { Anomaly, RuleVersion } from "@/types";
import { ANOMALY_TYPE_META, REVIEW_LABEL_META } from "@/types";
import { AnomalyBadge, ReviewBadge, StatusBadge } from "@/components/Badge";
import { StatCard } from "@/components/StatCard";
import { StatsCharts } from "@/components/StatsCharts";
import { formatNumber, formatTimestamp } from "@/utils/statistics";
import {
  buildRollbackTrail,
  downloadFile,
  exportReportCSV,
  generateReportFilename,
} from "@/utils/reportExporter";
import { getFullBatch, getRuleVersion } from "@/db/database";
import type { Batch } from "@/types";
import { computeStatistics } from "@/utils/statistics";

export default function Report() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const { ruleVersions, initStore, pushToast } = useAppStore();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rule, setRule] = useState<RuleVersion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initStore();
  }, [initStore]);

  useEffect(() => {
    if (!batchId) return;
    (async () => {
      setLoading(true);
      const b = await getFullBatch(batchId);
      if (b) {
        setBatch(b);
        const r = await getRuleVersion(b.ruleVersionId);
        if (r) setRule(r);
      }
      setLoading(false);
    })();
  }, [batchId]);

  const stats = useMemo(
    () => (batch ? computeStatistics(batch.anomalies, batch.decisions) : null),
    [batch]
  );

  const decisionMap = useMemo(() => {
    const m = new Map<string, string>();
    batch?.decisions.forEach((d) => m.set(d.anomalyId, d.label));
    return m;
  }, [batch]);

  const trails = useMemo(
    () => (batch ? buildRollbackTrail(batch, ruleVersions) : []),
    [batch, ruleVersions]
  );

  const handleExport = () => {
    if (!batch || !rule || !stats) return;
    const csv = exportReportCSV(batch, rule, stats);
    downloadFile(csv, generateReportFilename(batch.batchNo), "text/csv;charset=utf-8");
    pushToast("success", "报告已导出");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-industrial-400 text-sm">生成报告中...</div>
      </div>
    );
  }

  if (!batch || !stats || !rule) {
    return (
      <div className="card p-10 text-center">
        <AlertTriangle size={40} className="mx-auto text-industrial-300 mb-3" />
        <p className="text-industrial-500">未找到该批次或规则</p>
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
    <div className="space-y-6" id="report-content">
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
              <FileBarChart2 size={22} className="text-blue-500" />
              质检报告
            </h1>
          </div>
          <p className="mt-1 text-sm text-industrial-500 ml-10">
            批次 <span className="font-mono font-semibold">{batch.batchNo}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="btn-secondary text-xs">
            <Printer size={14} /> 打印
          </button>
          <button onClick={handleExport} className="btn-primary text-xs">
            <Download size={14} /> 导出 CSV
          </button>
        </div>
      </div>

      <div className="card p-5 bg-gradient-to-br from-blue-50/50 via-white to-industrial-50">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <ReportInfo label="批次编号" value={batch.batchNo} mono />
          <ReportInfo label="导入时间" value={formatTimestamp(batch.importedAt)} />
          <ReportInfo
            label="规则版本"
            value={`${rule.name} · v${rule.version}`}
          />
          <ReportInfo label="数据量" value={formatNumber(batch.totalRows, 0)} mono />
          <div>
            <p className="text-xs text-industrial-500 uppercase tracking-wide font-medium mb-1">状态</p>
            <StatusBadge status={batch.status} />
          </div>
        </div>
        {batch.note && (
          <div className="mt-3 pt-3 border-t border-industrial-200">
            <p className="text-xs text-industrial-500">备注: {batch.note}</p>
          </div>
        )}
        {trails.length > 0 && (
          <div className="mt-3 pt-3 border-t border-orange-200 bg-orange-50/30 -mx-5 -mb-5 px-5 py-3 rounded-b-xl mt-3">
            <p className="text-xs font-semibold text-orange-700 mb-1.5 flex items-center gap-1">
              <Clock size={12} /> 回滚痕迹
            </p>
            <ul className="text-xs text-orange-800 space-y-0.5">
              {trails.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
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
          subText={`${formatNumber(stats.confirmedFaultRate)}%`}
        />
        <StatCard
          label="误报"
          value={stats.byLabel.false_positive}
          icon={CheckCircle2}
          color="green"
          subText={`${formatNumber(stats.falsePositiveRate)}%`}
        />
        <StatCard
          label="忽略"
          value={stats.byLabel.ignored}
          icon={MinusCircle}
          color="gray"
        />
        <StatCard
          label="复核完成率"
          value={`${formatNumber(stats.completionRate)}%`}
          icon={CheckCircle2}
          color="blue"
          subText={`剩余 ${stats.byLabel.unreviewed} 条`}
        />
      </div>

      <StatsCharts stats={stats} />

      <div className="card p-5">
        <h3 className="section-title">
          <FileBarChart2 size={18} className="text-blue-500" />
          异常清单
        </h3>
        <div className="overflow-x-auto rounded-lg border border-industrial-200">
          <table className="w-full text-sm">
            <thead className="bg-industrial-50">
              <tr className="text-industrial-600 text-xs">
                <th className="py-2.5 px-3 text-left font-medium w-12">#</th>
                <th className="py-2.5 px-3 text-left font-medium">异常编号</th>
                <th className="py-2.5 px-3 text-left font-medium">类型</th>
                <th className="py-2.5 px-3 text-left font-medium">传感器</th>
                <th className="py-2.5 px-3 text-left font-medium">时间戳</th>
                <th className="py-2.5 px-3 text-right font-medium w-24">当前值</th>
                <th className="py-2.5 px-3 text-left font-medium">描述</th>
                <th className="py-2.5 px-3 text-left font-medium w-24">复核</th>
              </tr>
            </thead>
            <tbody>
              {batch.anomalies.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="py-10 text-center text-industrial-400"
                  >
                    该批次未检测到异常
                  </td>
                </tr>
              )}
              {batch.anomalies.map((a: Anomaly, idx: number) => (
                <tr key={a.id} className="border-t border-industrial-100 hover:bg-industrial-50/50">
                  <td className="py-2 px-3 text-xs font-mono text-industrial-400">
                    {idx + 1}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs text-industrial-700">
                    {a.id}
                  </td>
                  <td className="py-2 px-3">
                    <AnomalyBadge type={a.type} />
                  </td>
                  <td className="py-2 px-3 font-mono text-xs text-industrial-700">
                    {a.sensorName}
                  </td>
                  <td className="py-2 px-3 text-xs text-industrial-600 font-mono">
                    {formatTimestamp(a.timestamp)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs text-industrial-800">
                    {a.value === null ? "-" : a.value.toFixed(3)}
                  </td>
                  <td className="py-2 px-3 text-xs text-industrial-600 max-w-sm truncate">
                    {a.description}
                  </td>
                  <td className="py-2 px-3">
                    <ReviewBadge
                      label={
                        (decisionMap.get(a.id) as "confirmed_fault" | "false_positive" | "ignored") ??
                        "unreviewed"
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5 bg-industrial-900 text-white print:hidden">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">报告生成完成</p>
            <p className="text-xs text-industrial-400 mt-1">
              生成时间: {formatTimestamp(new Date().toISOString())}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="btn-secondary text-xs">
              <Printer size={14} /> 打印报告
            </button>
            <button onClick={handleExport} className="btn-primary text-xs">
              <Download size={14} /> 导出 CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportInfo({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-industrial-500 uppercase tracking-wide font-medium mb-1">
        {label}
      </p>
      <p className={`text-sm text-industrial-800 font-semibold ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}
