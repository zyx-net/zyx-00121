import type { AnomalyType, ReviewLabel } from "@/types";
import { ANOMALY_TYPE_META, REVIEW_LABEL_META } from "@/types";
import { AlertTriangle, AlertOctagon, TrendingUp, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const anomalyIcons = {
  missing: AlertTriangle,
  out_of_range: AlertOctagon,
  jump: TrendingUp,
  duplicate_timestamp: Copy,
};

export function AnomalyBadge({ type, showIcon = true }: { type: AnomalyType; showIcon?: boolean }) {
  const meta = ANOMALY_TYPE_META[type];
  const Icon = anomalyIcons[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
        meta.bgClass,
        meta.textClass
      )}
    >
      {showIcon && <Icon size={12} />}
      {meta.name}
    </span>
  );
}

export function ReviewBadge({ label }: { label: ReviewLabel | "unreviewed" }) {
  if (label === "unreviewed") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
        未复核
      </span>
    );
  }
  const meta = REVIEW_LABEL_META[label];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        meta.bgClass,
        meta.textClass
      )}
    >
      {meta.name}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    importing: { label: "导入中", cls: "bg-blue-100 text-blue-700" },
    detecting: { label: "检测中", cls: "bg-yellow-100 text-yellow-700" },
    reviewing: { label: "复核中", cls: "bg-purple-100 text-purple-700" },
    completed: { label: "已完成", cls: "bg-green-100 text-green-700" },
    rolled_back: { label: "已回滚", cls: "bg-orange-100 text-orange-700" },
  };
  const cfg = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        cfg.cls
      )}
    >
      {cfg.label}
    </span>
  );
}
