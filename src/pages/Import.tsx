import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  Download,
  ArrowRight,
  Sparkles,
  FileUp,
  Info,
  Settings,
  Clock,
  History,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type { ImportValidationResult, TimeParseConfig, TimeFormatPreset } from "@/types";
import {
  parseCSVFile,
  generateSampleCSV,
  generateMixedFormatSampleCSV,
  TIME_FORMAT_PRESETS,
  loadTimeParseConfig,
  saveTimeParseConfig,
} from "@/utils/csvParser";
import { formatNumber } from "@/utils/statistics";
import { downloadFile } from "@/utils/reportExporter";

const CUSTOM_FORMATS = [
  "YYYY-MM-DD HH:mm:ss",
  "YYYY/MM/DD HH:mm:ss",
  "YYYY-MM-DDTHH:mm:ss",
  "YYYYMMDD_HHmmss",
  "YYYY-MM-DD",
  "DD-MM-YYYY HH:mm:ss",
  "MM/DD/YYYY HH:mm:ss",
];

export default function Import() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    currentRuleVersionId,
    ruleVersions,
    getCurrentRule,
    createBatch,
    checkBatchExists,
    initStore,
    pushToast,
  } = useAppStore();

  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ImportValidationResult | null>(null);
  const [batchNo, setBatchNo] = useState(
    `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(
      Math.random() * 1000
    )
      .toString()
      .padStart(3, "0")}`
  );
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [dupCheck, setDupCheck] = useState<"idle" | "checking" | "duplicate" | "ok">("idle");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [timeConfig, setTimeConfig] = useState<TimeParseConfig>(() => loadTimeParseConfig());

  useEffect(() => {
    initStore();
  }, [initStore]);

  useEffect(() => {
    if (batchNo.trim()) {
      setDupCheck("checking");
      const t = setTimeout(async () => {
        const exists = await checkBatchExists(batchNo.trim());
        setDupCheck(exists ? "duplicate" : "ok");
      }, 300);
      return () => clearTimeout(t);
    } else {
      setDupCheck("idle");
    }
  }, [batchNo, checkBatchExists]);

  const rule = getCurrentRule();

  const handleTimePresetChange = (preset: TimeFormatPreset) => {
    const newConfig = { ...timeConfig, preset };
    setTimeConfig(newConfig);
    saveTimeParseConfig(newConfig);
    if (file && rule) {
      processFile(file, newConfig);
    }
  };

  const handleCustomFormatChange = (customFormat: string) => {
    const newConfig = { ...timeConfig, customFormat };
    setTimeConfig(newConfig);
    saveTimeParseConfig(newConfig);
    if (file && rule) {
      processFile(file, newConfig);
    }
  };

  const processFile = async (f: File, config?: TimeParseConfig) => {
    if (!rule) {
      pushToast("error", "请先在规则配置中创建规则");
      return;
    }
    setFile(f);
    setValidating(true);
    setValidation(null);
    try {
      const result = await parseCSVFile(f, rule, config || timeConfig);
      setValidation(result);
    } catch (e) {
      pushToast("error", "文件解析失败");
    } finally {
      setValidating(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".csv")) processFile(f);
    else pushToast("error", "请上传 CSV 文件");
  };

  const handleDownloadSample = () => {
    const csv = generateSampleCSV();
    downloadFile(csv, "sensor_sample_data.csv", "text/csv;charset=utf-8");
    pushToast("success", "样例数据已下载");
  };

  const handleDownloadMixedSample = () => {
    const csv = generateMixedFormatSampleCSV();
    downloadFile(csv, "sensor_mixed_format_sample.csv", "text/csv;charset=utf-8");
    pushToast("success", "混合格式样例数据已下载");
  };

  const handleCreate = async () => {
    if (!validation || !validation.valid || validation.dataPoints.length === 0) {
      pushToast("error", "数据校验失败，无法导入");
      return;
    }
    if (dupCheck === "duplicate") {
      pushToast("error", "批次编号已存在");
      return;
    }
    if (!currentRuleVersionId) {
      pushToast("error", "未选择规则版本");
      return;
    }

    setCreating(true);
    try {
      const batch = await createBatch(
        batchNo.trim(),
        note.trim(),
        currentRuleVersionId,
        validation.dataPoints,
        validation.parseMetadata
      );
      navigate(`/review/${batch.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-industrial-900 flex items-center gap-2">
            <FileUp size={22} className="text-primary-600" />
            数据导入
          </h1>
          <p className="mt-1 text-sm text-industrial-500">
            上传 CSV 时间序列文件进行自动异常检测
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleDownloadMixedSample} className="btn-secondary text-xs">
            <Download size={14} />
            下载混合格式样例
          </button>
          <button onClick={handleDownloadSample} className="btn-secondary text-xs">
            <Download size={14} />
            下载标准样例
          </button>
        </div>
      </div>

      <div className="card p-4 flex items-center justify-between bg-blue-50/50 border-blue-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
            <Info size={18} />
          </div>
          <div>
            <p className="text-sm font-medium text-industrial-800">
              当前规则: {rule?.name ?? "未选择"} · v{rule?.version ?? "?"}
            </p>
            <p className="text-xs text-industrial-500">
              支持的传感器:{" "}
              {rule?.sensorRules.map((s) => s.sensorName).join(", ") ?? "无"}
            </p>
          </div>
        </div>
        {ruleVersions.length > 1 && (
          <select
            value={currentRuleVersionId ?? ""}
            onChange={(e) => {
              useAppStore.getState().selectRuleVersion(e.target.value);
              setFile(null);
              setValidation(null);
            }}
            className="input !w-auto text-xs"
          >
            {ruleVersions.map((rv) => (
              <option key={rv.id} value={rv.id}>
                {rv.name} · v{rv.version}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="card p-5 bg-industrial-50/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title !mb-0 flex items-center gap-2">
            <Clock size={16} className="text-primary-600" />
            时间格式解析配置
          </h3>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <Settings size={14} />
            {showAdvanced ? "收起选项" : "高级选项"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          {TIME_FORMAT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => handleTimePresetChange(preset.value)}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                timeConfig.preset === preset.value
                  ? "border-primary-500 bg-primary-50"
                  : "border-industrial-200 bg-white hover:border-industrial-300"
              }`}
            >
              <p className={`font-medium text-sm ${
                timeConfig.preset === preset.value ? "text-primary-700" : "text-industrial-800"
              }`}>
                {preset.label}
              </p>
              <p className="text-xs text-industrial-500 mt-1">{preset.description}</p>
            </button>
          ))}
        </div>

        {showAdvanced && (
          <div className="space-y-4 pt-4 border-t border-industrial-200">
            {timeConfig.preset === "custom" && (
              <div>
                <label className="label">选择自定义格式</label>
                <select
                  value={timeConfig.customFormat || ""}
                  onChange={(e) => handleCustomFormatChange(e.target.value)}
                  className="input"
                >
                  <option value="">请选择格式</option>
                  {CUSTOM_FORMATS.map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {fmt}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-industrial-500 mt-1">
                  选择与您 CSV 文件中时间戳格式匹配的模式
                </p>
              </div>
            )}

            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs text-yellow-800">
                <strong>💡 提示：</strong>您选择的时间格式配置会自动保存，下次打开时会沿用上次的选择。
                如果手动配置与自动识别结果冲突，系统会优先使用您选择的配置，并记录冲突日志。
              </p>
            </div>
          </div>
        )}

        {validation && validation.parseMetadata && (
          <div className="mt-4 pt-4 border-t border-industrial-200">
            <h4 className="text-sm font-medium text-industrial-800 mb-3 flex items-center gap-2">
              <History size={14} className="text-primary-600" />
              本次解析统计
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-2 bg-white rounded border border-industrial-200">
                <p className="text-xs text-industrial-500">使用的预设</p>
                <p className="font-mono text-sm font-bold text-primary-700">
                  {TIME_FORMAT_PRESETS.find(p => p.value === validation.parseMetadata.timeConfig.preset)?.label}
                </p>
              </div>
              <div className="p-2 bg-white rounded border border-industrial-200">
                <p className="text-xs text-industrial-500">检测到的格式</p>
                <p className="font-mono text-sm font-bold text-industrial-700">
                  {Object.keys(validation.parseMetadata.autoDetectedFormatCounts).length} 种
                </p>
              </div>
              <div className="p-2 bg-white rounded border border-industrial-200">
                <p className="text-xs text-industrial-500">解析冲突</p>
                <p className={`font-mono text-sm font-bold ${
                  validation.parseMetadata.conflicts.length > 0 ? "text-orange-600" : "text-green-600"
                }`}>
                  {validation.parseMetadata.conflicts.length} 条
                </p>
              </div>
              <div className="p-2 bg-white rounded border border-industrial-200">
                <p className="text-xs text-industrial-500">解析错误</p>
                <p className={`font-mono text-sm font-bold ${
                  validation.parseMetadata.parseErrors.length > 0 ? "text-red-600" : "text-green-600"
                }`}>
                  {validation.parseMetadata.parseErrors.length} 条
                </p>
              </div>
            </div>

            {Object.keys(validation.parseMetadata.autoDetectedFormatCounts).length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-industrial-500 mb-2">格式分布：</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(validation.parseMetadata.autoDetectedFormatCounts).map(([format, count]) => (
                    <span key={format} className="px-2 py-1 bg-industrial-100 text-industrial-700 rounded text-xs">
                      {format}: {count} 行
                    </span>
                  ))}
                </div>
              </div>
            )}

            {validation.parseMetadata.conflicts.length > 0 && (
              <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-xs text-orange-800 font-medium mb-2">
                  ⚠️ 检测到 {validation.parseMetadata.conflicts.length} 条时间解析冲突
                </p>
                <p className="text-xs text-orange-700">
                  自动识别与手动配置的解析结果不一致，已优先使用您选择的「{TIME_FORMAT_PRESETS.find(p => p.value === validation.parseMetadata.timeConfig.preset)?.label}」格式。
                  详细冲突记录将随报告一起导出。
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className={`card p-8 border-2 border-dashed transition-all ${
          dragging
            ? "border-primary-500 bg-primary-50"
            : "border-industrial-300 hover:border-industrial-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) processFile(f);
            e.target.value = "";
          }}
        />
        <div className="text-center">
          <div
            className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${
              dragging
                ? "bg-primary-100 text-primary-600"
                : "bg-industrial-100 text-industrial-400"
            }`}
          >
            <Upload size={28} />
          </div>
          <p className="font-semibold text-industrial-800">
            {validating ? "正在校验文件..." : file ? file.name : "点击或拖拽 CSV 文件到此处"}
          </p>
          <p className="text-xs text-industrial-500 mt-1">
            CSV 格式: timestamp, sensorName, value
          </p>
          {validating && (
            <div className="mt-4 inline-block animate-pulse text-xs text-primary-600">
              <Sparkles size={14} className="inline mr-1" />
              解析中...
            </div>
          )}
        </div>
      </div>

      {validation && (
        <div className="card p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title !mb-0">
              {validation.valid && validation.dataPoints.length > 0 ? (
                <>
                  <CheckCircle2 size={18} className="text-green-500" />
                  校验通过
                </>
              ) : (
                <>
                  <AlertCircle size={18} className="text-red-500" />
                  校验结果
                </>
              )}
            </h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatChip label="总行数" value={validation.rowCount} color="blue" />
            <StatChip
              label="有效数据"
              value={validation.dataPoints.length}
              color="green"
            />
            <StatChip
              label="错误数"
              value={validation.errors.length}
              color={validation.errors.length > 0 ? "red" : "gray"}
            />
            <StatChip
              label="警告"
              value={validation.warnings.length}
              color={validation.warnings.length > 0 ? "orange" : "gray"}
            />
          </div>

          {validation.warnings.length > 0 && (
            <div className="mb-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
              {validation.warnings.map((w, i) => (
                <p key={i} className="text-xs text-yellow-800">
                  ⚠️ {w}
                </p>
              ))}
            </div>
          )}

          {validation.errors.length > 0 && (
            <div className="mb-4 max-h-48 overflow-auto rounded-lg border border-red-200">
              <table className="w-full text-xs">
                <thead className="bg-red-50 sticky top-0">
                  <tr className="text-red-700">
                    <th className="text-left py-2 px-3 w-16">行号</th>
                    <th className="text-left py-2 px-3 w-24">列</th>
                    <th className="text-left py-2 px-3 w-24">类型</th>
                    <th className="text-left py-2 px-3">错误信息</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.errors.slice(0, 100).map((e, i) => (
                    <tr key={i} className="border-t border-red-100">
                      <td className="py-1.5 px-3 font-mono text-industrial-600">
                        {e.row}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-industrial-600">
                        {e.column}
                      </td>
                      <td className="py-1.5 px-3">
                        <span className="px-1.5 py-0.5 rounded text-red-700 bg-red-100 font-medium">
                          {e.type}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-industrial-700">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validation.errors.length > 100 && (
                <p className="text-xs text-industrial-400 py-2 px-3 bg-red-50">
                  仅显示前 100 条错误，共 {validation.errors.length} 条
                </p>
              )}
            </div>
          )}

          <div className="pt-4 border-t border-industrial-100 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">
                批次编号
                {dupCheck === "duplicate" && (
                  <span className="text-red-500 ml-2">⚠ 已存在</span>
                )}
                {dupCheck === "ok" && (
                  <span className="text-green-500 ml-2">✓ 可用</span>
                )}
              </label>
              <input
                className="input"
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
              />
            </div>
            <div>
              <label className="label">备注</label>
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="可选"
              />
            </div>
          </div>

          <div className="flex justify-end mt-5">
            <button
              onClick={handleCreate}
              disabled={
                creating ||
                !validation.valid ||
                validation.dataPoints.length === 0 ||
                dupCheck === "duplicate"
              }
              className="btn-primary"
            >
              {creating ? "导入中..." : "开始检测并导入"}
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="card p-5 bg-industrial-50/50">
        <h3 className="section-title !mb-2">
          <FileText size={16} className="text-industrial-500" />
          CSV 格式说明
        </h3>
        <div className="text-xs text-industrial-600 space-y-1">
          <p>
            <code className="px-1.5 py-0.5 bg-white rounded font-mono border">
              timestamp, sensorName, value
            </code>
          </p>
          <p>
            时间戳支持格式: YYYY-MM-DD HH:mm:ss、YYYY/MM/DD HH:mm:ss、ISO 8601、Unix 时间戳（秒/毫秒）、自定义格式
          </p>
          <p>
            sensorName 必须与规则配置中的传感器名称完全匹配，否则将提示「未知传感器」
          </p>
          <p className="text-primary-600 font-medium">
            🆕 导出的报告将包含：原始时间戳、标准化时间、时间格式说明、解析冲突日志
          </p>
        </div>
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "green" | "red" | "orange" | "gray";
}) {
  const map: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    gray: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return (
    <div className={`px-3 py-2 rounded-lg border ${map[color]}`}>
      <p className="text-xs opacity-75">{label}</p>
      <p className="text-lg font-bold font-mono">{formatNumber(value, 0)}</p>
    </div>
  );
}
