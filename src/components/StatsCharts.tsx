import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { StatisticsSummary } from "@/types";
import { ANOMALY_TYPE_META, REVIEW_LABEL_META } from "@/types";

interface Props {
  stats: StatisticsSummary;
}

export function StatsCharts({ stats }: Props) {
  const typeData = (Object.keys(stats.byType) as Array<keyof typeof stats.byType>).map(
    (k) => ({
      name: ANOMALY_TYPE_META[k].name,
      value: stats.byType[k],
      color: ANOMALY_TYPE_META[k].color,
    })
  );

  const sensorData = Object.entries(stats.bySensor).map(([name, value]) => ({
    name,
    value,
  }));

  const labelData = (
    Object.keys(stats.byLabel) as Array<keyof typeof stats.byLabel>
  ).map((k) => ({
    name:
      k === "unreviewed"
        ? "未复核"
        : REVIEW_LABEL_META[k as keyof typeof REVIEW_LABEL_META].name,
    value: stats.byLabel[k],
    color:
      k === "unreviewed"
        ? "#94a3b8"
        : REVIEW_LABEL_META[k as keyof typeof REVIEW_LABEL_META].color,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="bg-white rounded-xl border border-industrial-200 shadow-card p-4">
        <h4 className="text-sm font-semibold text-industrial-700 mb-2">
          异常类型分布
        </h4>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={typeData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                label={({ name, percent }) =>
                  percent > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
                }
                labelLine={false}
              >
                {typeData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-industrial-200 shadow-card p-4">
        <h4 className="text-sm font-semibold text-industrial-700 mb-2">
          复核标签分布
        </h4>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={labelData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                label={({ name, percent }) =>
                  percent > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
                }
                labelLine={false}
              >
                {labelData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-industrial-200 shadow-card p-4">
        <h4 className="text-sm font-semibold text-industrial-700 mb-2">
          各传感器异常数
        </h4>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sensorData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 11 }}
              />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
