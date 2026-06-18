import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  Clock,
  FileUp,
  Settings2,
  ClipboardCheck,
  ArrowRight,
  FileX,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/Badge";
import { formatNumber, formatTimestamp } from "@/utils/statistics";
import { useEffect } from "react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { batchList, initStore, ruleVersions, loading } = useAppStore();

  useEffect(() => {
    initStore();
  }, [initStore]);

  const totalBatches = batchList.length;
  const totalAnomalies = batchList.reduce((sum, b) => {
    return sum + b.totalRows;
  }, 0);
  const reviewingCount = batchList.filter(
    (b) => b.status === "reviewing" || b.status === "detecting"
  ).length;
  const completedCount = batchList.filter((b) => b.status === "completed").length;

  const recentBatches = batchList.slice(0, 8);

  if (loading && batchList.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-industrial-400 text-sm">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-industrial-900">仪表盘</h1>
          <p className="mt-1 text-sm text-industrial-500">
            传感器质检数据总览 · 当前规则版本数 {ruleVersions.length}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="总批次数"
          value={totalBatches}
          icon={Activity}
          color="blue"
          subText="累计导入"
        />
        <StatCard
          label="总数据点"
          value={formatNumber(totalAnomalies)}
          icon={FileX}
          color="purple"
          subText="累计采集"
        />
        <StatCard
          label="待复核"
          value={reviewingCount}
          icon={Clock}
          color="orange"
          subText="需要人工处理"
        />
        <StatCard
          label="已完成"
          value={completedCount}
          icon={CheckCircle2}
          color="green"
          subText="已归档批次"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title !mb-0">
              <Activity size={18} className="text-primary-600" />
              最近批次
            </h3>
            <button
              onClick={() => navigate("/history")}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
            >
              查看全部 <ArrowRight size={14} />
            </button>
          </div>

          {recentBatches.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-industrial-300 mb-2">
                <ClipboardCheck size={40} className="mx-auto" />
              </div>
              <p className="text-sm text-industrial-500">暂无数据批次</p>
              <p className="text-xs text-industrial-400 mt-1">
                请先在「数据导入」页面上传 CSV 文件
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-industrial-200 text-industrial-500">
                    <th className="text-left py-2.5 px-2 font-medium">批次编号</th>
                    <th className="text-left py-2.5 px-2 font-medium">导入时间</th>
                    <th className="text-right py-2.5 px-2 font-medium">数据量</th>
                    <th className="text-left py-2.5 px-2 font-medium">状态</th>
                    <th className="text-right py-2.5 px-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBatches.map((b) => (
                    <tr
                      key={b.id}
                      className="border-b border-industrial-100 hover:bg-industrial-50 transition"
                    >
                      <td className="py-3 px-2 font-mono text-industrial-800 font-medium">
                        {b.batchNo}
                      </td>
                      <td className="py-3 px-2 text-industrial-600">
                        {formatTimestamp(b.importedAt)}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-industrial-700">
                        {formatNumber(b.totalRows)}
                      </td>
                      <td className="py-3 px-2">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="py-3 px-2 text-right space-x-1">
                        <button
                          onClick={() => navigate(`/review/${b.id}`)}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                        >
                          复核
                        </button>
                        <span className="text-industrial-300">|</span>
                        <button
                          onClick={() => navigate(`/report/${b.id}`)}
                          className="text-xs text-industrial-500 hover:text-industrial-700 font-medium"
                        >
                          报告
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div
            className="card p-5 cursor-pointer hover:shadow-card-hover transition-all group"
            onClick={() => navigate("/import")}
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center group-hover:bg-primary-100 transition">
                <FileUp size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-industrial-800">数据导入</h3>
                <p className="text-xs text-industrial-500 mt-1">
                  上传 CSV 时间序列文件进行异常检测
                </p>
              </div>
              <ArrowRight
                size={18}
                className="text-industrial-300 group-hover:text-primary-600 transition"
              />
            </div>
          </div>

          <div
            className="card p-5 cursor-pointer hover:shadow-card-hover transition-all group"
            onClick={() => navigate("/rules")}
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center group-hover:bg-orange-100 transition">
                <Settings2 size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-industrial-800">规则配置</h3>
                <p className="text-xs text-industrial-500 mt-1">
                  管理设备、传感器范围、阈值和缺失规则
                </p>
              </div>
              <ArrowRight
                size={18}
                className="text-industrial-300 group-hover:text-orange-600 transition"
              />
            </div>
          </div>

          <div className="card p-5 bg-industrial-900 text-white border-industrial-800">
            <div className="flex items-start gap-3">
              <AlertOctagon size={22} className="text-accent-orange mt-0.5" />
              <div>
                <h3 className="font-semibold">检测四类异常</h3>
                <ul className="text-xs text-industrial-300 mt-2 space-y-1">
                  <li>• 数据缺失（时间间隔过大）</li>
                  <li>• 越界异常（超出传感器范围）</li>
                  <li>• 跳变异常（数值突变）</li>
                  <li>• 重复时间戳</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
