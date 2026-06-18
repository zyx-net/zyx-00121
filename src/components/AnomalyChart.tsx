import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import type { Anomaly, DataPoint } from "@/types";
import { ANOMALY_TYPE_META } from "@/types";
import { useMemo } from "react";

interface Props {
  dataPoints: DataPoint[];
  anomaly: Anomaly;
  contextRange?: number;
}

export function AnomalyChart({ dataPoints, anomaly, contextRange = 20 }: Props) {
  const chartData = useMemo(() => {
    const sensorPoints = dataPoints
      .filter((dp) => dp.sensorName === anomaly.sensorName)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

    const anomalyIdx = sensorPoints.findIndex(
      (dp) => dp.timestamp === anomaly.timestamp
    );
    const start = Math.max(0, anomalyIdx - contextRange);
    const end = Math.min(sensorPoints.length, anomalyIdx + contextRange + 1);
    const slice = sensorPoints.slice(start, end);

    return slice.map((dp) => ({
      ...dp,
      time: new Date(dp.timestamp).toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      isAnomaly: dp.timestamp === anomaly.timestamp,
    }));
  }, [dataPoints, anomaly, contextRange]);

  if (chartData.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-industrial-400">
        无上下文数据可展示
      </div>
    );
  }

  const color = ANOMALY_TYPE_META[anomaly.type].color;

  return (
    <div className="w-full h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#64748b" }}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={50} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #e2e8f0",
            }}
            labelStyle={{ fontWeight: 600 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={1.8}
            dot={{ r: 2, fill: "#3b82f6" }}
            activeDot={{ r: 5 }}
          />
          {chartData.map(
            (d, i) =>
              d.isAnomaly && (
                <ReferenceDot
                  key={i}
                  x={d.time}
                  y={d.value}
                  r={6}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={2}
                />
              )
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
