import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: "blue" | "red" | "green" | "orange" | "purple" | "gray";
  subText?: string;
}

const colorClasses: Record<StatCardProps["color"], { bg: string; icon: string; border: string }> = {
  blue: { bg: "bg-blue-50", icon: "bg-blue-500 text-white", border: "border-blue-100" },
  red: { bg: "bg-red-50", icon: "bg-red-500 text-white", border: "border-red-100" },
  green: { bg: "bg-green-50", icon: "bg-green-500 text-white", border: "border-green-100" },
  orange: { bg: "bg-orange-50", icon: "bg-orange-500 text-white", border: "border-orange-100" },
  purple: { bg: "bg-purple-50", icon: "bg-purple-500 text-white", border: "border-purple-100" },
  gray: { bg: "bg-slate-50", icon: "bg-slate-500 text-white", border: "border-slate-200" },
};

export function StatCard({ label, value, icon: Icon, color, subText }: StatCardProps) {
  const cls = colorClasses[color];
  return (
    <div
      className={cn(
        "bg-white rounded-xl border shadow-card p-5 transition-all hover:shadow-card-hover",
        cls.border
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-industrial-500 font-medium uppercase tracking-wide">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold text-industrial-900 font-mono">
            {value}
          </p>
          {subText && (
            <p className="mt-1 text-xs text-industrial-400">{subText}</p>
          )}
        </div>
        <div
          className={cn(
            "w-12 h-12 rounded-lg flex items-center justify-center shadow-md",
            cls.icon
          )}
        >
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}
