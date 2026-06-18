import { X, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

const iconMap = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: "bg-green-50 border-green-200 text-green-800",
  error: "bg-red-50 border-red-200 text-red-800",
  warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
};

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore();

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => {
        const Icon = iconMap[t.type];
        return (
          <div
            key={t.id}
            className={`animate-slide-in flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg ${colorMap[t.type]}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="text-sm flex-1 leading-relaxed">{t.message}</p>
            <button
              onClick={() => removeToast(t.id)}
              className="opacity-60 hover:opacity-100 transition"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
