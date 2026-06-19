import { useState, useEffect, useMemo, useRef } from "react";
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
  Braces,
  Map,
  ShieldAlert,
  Table2,
  ChevronDown,
  ChevronUp,
  Trash2,
  RotateCcw,
  Play,
  FileJson,
  List,
  FileWarning,
  Database,
  RefreshCw,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type {
  ImportValidationResult,
  TimeParseConfig,
  TimeFormatPreset,
  DataSourceType,
  PrecheckResult,
  ImportOperationLog,
} from "@/types";
import {
  parseCSVFile,
  generateSampleCSV,
  generateMixedFormatSampleCSV,
  TIME_FORMAT_PRESETS,
  loadTimeParseConfig,
  saveTimeParseConfig,
} from "@/utils/csvParser";
import { parseJSONFile, generateSampleJSON } from "@/utils/jsonParser";
import { precheckCSV, precheckJSON } from "@/utils/importPrecheck";
import {
  loadPerSourceConfig,
  savePerSourceConfig,
  listPerSourceConfigs,
} from "@/utils/perSourceTimeConfig";
import { formatNumber } from "@/utils/statistics";
import { downloadFile } from "@/utils/reportExporter";
import { ANOMALY_TYPE_META } from "@/types";
import { loadAllLogs, formatLogSummary } from "@/utils/importLogger";

const CUSTOM_FORMATS = [
  "YYYY-MM-DD HH:mm:ss",
  "YYYY/MM/DD HH:mm:ss",
  "YYYY-MM-DDTHH:mm:ss",
  "YYYYMMDD_HHmmss",
  "YYYY-MM-DD",
  "DD-MM-YYYY HH:mm:ss",
  "MM/DD/YYYY HH:mm:ss",
];

type WorkbenchTab = "import" | "history" | "logs";

export default function PrecheckWorkbench() {
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
    rollbackBatchById,
    reimportBatch,
    loadBatchList,
    batchList,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<WorkbenchTab>("import");
  const [sourceType, setSourceType] = useState<DataSourceType>("csv");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ImportValidationResult | null>(null);
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
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
  const [conflictsExpanded, setConflictsExpanded] = useState(false);
  const [usingPerSource, setUsingPerSource] = useState(false);
  const [savedSourceConfigs, setSavedSourceConfigs] = useState<
    Array<{ sourceName: string; config: TimeParseConfig; updatedAt: string }>
  >([]);
  const [operationLogs, setOperationLogs] = useState<ImportOperationLog[]>([]);
  const [refreshingLogs, setRefreshingLogs] = useState(false);

  const [timeConfig, setTimeConfig] = useState<TimeParseConfig>(() => loadTimeParseConfig());

  useEffect(() => {
    initStore();
  }, [initStore]);

  useEffect(() => {
    setSavedSourceConfigs(listPerSourceConfigs());
  }, []);

  useEffect(() => {
    if (activeTab === "logs") {
      refreshLogs();
    }
  }, [activeTab]);

  const refreshLogs = () => {
    setRefreshingLogs(true);
    setOperationLogs(loadAllLogs());
    setTimeout(() => setRefreshingLogs(false), 300);
  };

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
      savePerSourceConfig(file.name, newConfig);
    }
    if (file && rule) {
      processFile(file, newConfig);
    }
  };

  const handleCustomFormatChange = (customFormat: string) => {
    const newConfig = { ...timeConfig, customFormat };
    setTimeConfig(newConfig);
    saveTimeParseConfig(newConfig);
    if (file && rule) {
      savePerSourceConfig(file.name, newConfig);
    }
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
    setPrecheck(null);

    const perSourceConfig = loadPerSourceConfig(f.name);
    const globalConfig = config || timeConfig;
    const effectiveConfig = perSourceConfig || globalConfig;
    setUsingPerSource(!!perSourceConfig && !config);
    if (perSourceConfig && !config) {
      setTimeConfig(perSourceConfig);
    }

    try {
      let valResult: ImportValidationResult;
      let precheckResult: PrecheckResult;

      if (sourceType === "csv") {
        valResult = await parseCSVFile(f, rule, effectiveConfig);
        precheckResult = await precheckCSV(f, rule, effectiveConfig);
      } else {
        valResult = await parseJSONFile(f, rule, effectiveConfig);
        precheckResult = await precheckJSON(f, rule, effectiveConfig);
      }

      setValidation(valResult);
      setPrecheck(precheckResult);
      savePerSourceConfig(f.name, effectiveConfig);
      setSavedSourceConfigs(listPerSourceConfigs());

      if (valResult.parseMetadata?.hasBOM) {
        pushToast("info", "检测到 UTF-8 BOM（Windows 常见格式），已自动处理");
      }
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
    if (!f) return;
    const ext = f.name.toLowerCase();
    if (sourceType === "csv" && ext.endsWith(".csv")) {
      processFile(f);
    } else if (sourceType === "json" && ext.endsWith(".json")) {
      processFile(f);
    } else {
      pushToast("error", `请上传 ${sourceType.toUpperCase()} 文件`);
    }
  };

  const handleDownloadSampleCSV = () => {
    const csv = generateSampleCSV();
    downloadFile(csv, "sensor_sample_data.csv", "text/csv;charset=utf-8");
    pushToast("success", "样例数据已下载");
  };

  const handleDownloadMixedSampleCSV = () => {
    const csv = generateMixedFormatSampleCSV();
    downloadFile(csv, "sensor_mixed_format_sample.csv", "text/csv;charset=utf-8");
    pushToast("success", "混合格式样例数据已下载");
  };

  const handleDownloadSampleJSON = () => {
    const json = generateSampleJSON();
    downloadFile(json, "sensor_sample_data.json", "application/json;charset=utf-8");
    pushToast("success", "JSON 样例数据已下载");
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
        validation.parseMetadata,
        {
          valid: validation.valid,
          errors: validation.errors,
          rowCount: validation.rowCount,
        }
      );
      navigate(`/review/${batch.id}`);
    } finally {
      setCreating(false);
    }
  };

  const handleRollback = async (batchId: string, batchNo: string) => {
    if (!confirm(`确定要撤销批次 ${batchNo} 吗？这将删除该批次的所有数据。`)) {
      return;
    }
    const success = await rollbackBatchById(batchId, "用户手动撤销");
    if (success) {
      await loadBatchList();
    }
  };

  const handleReimport = async (batchId: string, oldBatchNo: string) => {
    const newBatchNo = prompt(
      "请输入新的批次编号：",
      `${oldBatchNo}_REIMPORT_${Date.now().toString().slice(-6)}`
    );
    if (!newBatchNo) return;

    const exists = await checkBatchExists(newBatchNo.trim());
    if (exists) {
      pushToast("error", "批次编号已存在，请使用其他编号");
      return;
    }

    const result = await reimportBatch(batchId, newBatchNo.trim(), `从 ${oldBatchNo} 重导`);
    if (result) {
      await loadBatchList();
      navigate(`/review/${result.id}`);
    }
  };

  const acceptExt = sourceType === "csv" ? ".csv" : ".json";
  const uploadHint =
    sourceType === "csv"
      ? "CSV 格式: timestamp, sensorName, value"
      : "JSON 格式: [{ timestamp, sensorName, value }]";

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-industrial-900 flex items-center gap-2">
            <Database size={22} className="text-primary-600" />
            导入预检工作台
          </h1>
          <p className="mt-1 text-sm text-industrial-500">
            完整的导入预检、正式导入、结果回看工作流
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-industrial-200">
        <button
          onClick={() => setActiveTab("import")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "import"
              ? "border-primary-500 text-primary-600"
              : "border-transparent text-industrial-500 hover:text-industrial-700"
          }`}
        >
          <FileUp size={14} className="inline mr-1.5" />
          数据导入
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "history"
              ? "border-primary-500 text-primary-600"
              : "border-transparent text-industrial-500 hover:text-industrial-700"
          }`}
        >
          <History size={14} className="inline mr-1.5" />
          历史批次
        </button>
        <button
          onClick={() => {
            setActiveTab("logs");
            refreshLogs();
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "logs"
              ? "border-primary-500 text-primary-600"
              : "border-transparent text-industrial-500 hover:text-industrial-700"
          }`}
        >
          <List size={14} className="inline mr-1.5" />
          操作日志
        </button>
      </div>

      {activeTab === "import" && (
        <div className="space-y-6">
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
                  setPrecheck(null);
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

            {usingPerSource && (
              <div className="mb-3 p-2.5 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center gap-2">
                <Info size={14} className="text-indigo-600 flex-shrink-0" />
                <p className="text-xs text-indigo-800">
                  使用该文件保存的专属配置（{TIME_FORMAT_PRESETS.find(
                    (p) => p.value === timeConfig.preset
                  )?.label ?? timeConfig.preset}
                  ）
                </p>
              </div>
            )}

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
                  <p
                    className={`font-medium text-sm ${
                      timeConfig.preset === preset.value
                        ? "text-primary-700"
                        : "text-industrial-800"
                    }`}
                  >
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
                      选择与您文件中时间戳格式匹配的模式
                    </p>
                  </div>
                )}

                {savedSourceConfigs.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-industrial-800 mb-2 flex items-center gap-1.5">
                      <History size={14} className="text-primary-600" />
                      已保存的文件专属配置
                    </h4>
                    <div className="space-y-1.5 max-h-32 overflow-auto">
                      {savedSourceConfigs.map((entry) => (
                        <div
                          key={entry.sourceName}
                          className="flex items-center justify-between px-3 py-1.5 bg-white rounded border border-industrial-200 text-xs"
                        >
                          <span className="font-mono text-industrial-700 truncate mr-3">
                            {entry.sourceName}
                          </span>
                          <span className="text-industrial-500 flex-shrink-0">
                            {TIME_FORMAT_PRESETS.find(
                              (p) => p.value === entry.config.preset
                            )?.label ?? entry.config.preset}
                            {entry.config.customFormat ? ` (${entry.config.customFormat})` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-800">
                    <strong>💡 提示：</strong>您选择的时间格式配置会自动保存，下次打开时会沿用上次的选择。
                    每个文件也会保存专属配置，再次导入同一文件时自动应用。如果手动配置与自动识别结果冲突，系统会优先使用您选择的配置，并记录冲突日志。
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
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="p-2 bg-white rounded border border-industrial-200">
                    <p className="text-xs text-industrial-500">使用的预设</p>
                    <p className="font-mono text-sm font-bold text-primary-700">
                      {TIME_FORMAT_PRESETS.find(
                        (p) => p.value === validation.parseMetadata.timeConfig.preset
                      )?.label}
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
                    <p
                      className={`font-mono text-sm font-bold ${
                        validation.parseMetadata.conflicts.length > 0
                          ? "text-orange-600"
                          : "text-green-600"
                      }`}
                    >
                      {validation.parseMetadata.conflicts.length} 条
                    </p>
                  </div>
                  <div className="p-2 bg-white rounded border border-industrial-200">
                    <p className="text-xs text-industrial-500">解析错误</p>
                    <p
                      className={`font-mono text-sm font-bold ${
                        validation.parseMetadata.parseErrors.length > 0
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {validation.parseMetadata.parseErrors.length} 条
                    </p>
                  </div>
                  <div className="p-2 bg-white rounded border border-industrial-200">
                    <p className="text-xs text-industrial-500">UTF-8 BOM</p>
                    <p
                      className={`font-mono text-sm font-bold ${
                        validation.parseMetadata.hasBOM
                          ? "text-blue-600"
                          : "text-gray-600"
                      }`}
                    >
                      {validation.parseMetadata.hasBOM ? "已检测" : "无"}
                    </p>
                  </div>
                </div>

                {Object.keys(validation.parseMetadata.autoDetectedFormatCounts).length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-industrial-500 mb-2">格式分布：</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(validation.parseMetadata.autoDetectedFormatCounts).map(
                        ([format, count]) => (
                          <span
                            key={format}
                            className="px-2 py-1 bg-industrial-100 text-industrial-700 rounded text-xs"
                          >
                            {format}: {count} 行
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}

                {validation.parseMetadata.conflicts.length > 0 && (
                  <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-xs text-orange-800 font-medium mb-2">
                      ⚠️ 检测到 {validation.parseMetadata.conflicts.length} 条时间解析冲突
                    </p>
                    <p className="text-xs text-orange-700">
                      自动识别与手动配置的解析结果不一致，已优先使用您选择的「
                      {TIME_FORMAT_PRESETS.find(
                        (p) => p.value === validation.parseMetadata.timeConfig.preset
                      )?.label}
                      」格式。详细冲突记录将随报告一起导出。
                    </p>
                  </div>
                )}

                {validation.parseMetadata.hasBOM && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-800 font-medium mb-2">
                      ℹ️ UTF-8 BOM 检测
                    </p>
                    <p className="text-xs text-blue-700">
                      检测到 UTF-8 BOM（Windows 常见格式），已自动处理。BOM 不会影响数据解析结果。
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
              accept={acceptExt}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processFile(f);
                e.target.value = "";
              }}
            />
            <div className="text-center">
              <div className="flex items-center justify-center mb-4">
                <div className="inline-flex rounded-lg border border-industrial-200 bg-white overflow-hidden">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSourceType("csv");
                      setFile(null);
                      setValidation(null);
                      setPrecheck(null);
                    }}
                    className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                      sourceType === "csv"
                        ? "bg-primary-600 text-white"
                        : "text-industrial-600 hover:bg-industrial-50"
                    }`}
                  >
                    <FileText size={14} />
                    CSV
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSourceType("json");
                      setFile(null);
                      setValidation(null);
                      setPrecheck(null);
                    }}
                    className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                      sourceType === "json"
                        ? "bg-primary-600 text-white"
                        : "text-industrial-600 hover:bg-industrial-50"
                    }`}
                  >
                    <Braces size={14} />
                    JSON
                  </button>
                </div>
              </div>
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
                {validating
                  ? "正在校验文件..."
                  : file
                  ? file.name
                  : `点击或拖拽 ${sourceType.toUpperCase()} 文件到此处`}
              </p>
              <p className="text-xs text-industrial-500 mt-1">{uploadHint}</p>
              {validating && (
                <div className="mt-4 inline-block animate-pulse text-xs text-primary-600">
                  <Sparkles size={14} className="inline mr-1" />
                  解析中...
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-center">
            {sourceType === "csv" && (
              <>
                <button onClick={handleDownloadMixedSampleCSV} className="btn-secondary text-xs">
                  <Download size={14} />
                  下载混合格式样例
                </button>
                <button onClick={handleDownloadSampleCSV} className="btn-secondary text-xs">
                  <Download size={14} />
                  下载标准样例
                </button>
              </>
            )}
            {sourceType === "json" && (
              <button onClick={handleDownloadSampleJSON} className="btn-secondary text-xs">
                <Download size={14} />
                下载 JSON 样例
              </button>
            )}
          </div>

          {precheck && (
            <div className="space-y-4 animate-fade-in">
              <div className="card p-5">
                <h3 className="section-title flex items-center gap-2">
                  <Map size={16} className="text-primary-600" />
                  字段映射
                </h3>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg border border-green-200 bg-green-50/50">
                    <p className="text-xs text-green-700 font-medium mb-2">已映射字段</p>
                    <div className="space-y-1.5">
                      {precheck.fieldMapping.mappedFields.timestamp && (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 size={12} className="text-green-600" />
                          <span className="text-industrial-600">timestamp →</span>
                          <span className="font-mono text-green-800 font-medium">
                            {precheck.fieldMapping.mappedFields.timestamp}
                          </span>
                        </div>
                      )}
                      {precheck.fieldMapping.mappedFields.sensorName && (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 size={12} className="text-green-600" />
                          <span className="text-industrial-600">sensorName →</span>
                          <span className="font-mono text-green-800 font-medium">
                            {precheck.fieldMapping.mappedFields.sensorName}
                          </span>
                        </div>
                      )}
                      {precheck.fieldMapping.mappedFields.value && (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 size={12} className="text-green-600" />
                          <span className="text-industrial-600">value →</span>
                          <span className="font-mono text-green-800 font-medium">
                            {precheck.fieldMapping.mappedFields.value}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border border-orange-200 bg-orange-50/50">
                    <p className="text-xs text-orange-700 font-medium mb-2">未映射字段</p>
                    {precheck.fieldMapping.unmappedFields.length > 0 ? (
                      <div className="space-y-1">
                        {precheck.fieldMapping.unmappedFields.map((f) => (
                          <div key={f} className="flex items-center gap-2 text-xs">
                            <AlertCircle size={12} className="text-orange-500" />
                            <span className="font-mono text-orange-800">{f}</span>
                            {precheck.fieldMapping.suggestions[f] && (
                              <span className="text-orange-600">
                                → 可能是 {precheck.fieldMapping.suggestions[f].join("/")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-industrial-400">无</p>
                    )}
                  </div>
                  <div className="p-3 rounded-lg border border-red-200 bg-red-50/50">
                    <p className="text-xs text-red-700 font-medium mb-2">缺失字段</p>
                    {precheck.fieldMapping.missingFields.length > 0 ? (
                      <div className="space-y-1">
                        {precheck.fieldMapping.missingFields.map((f) => (
                          <div key={f} className="flex items-center gap-2 text-xs">
                            <AlertCircle size={12} className="text-red-500" />
                            <span className="font-mono text-red-800 font-medium">{f}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-industrial-400">无</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-industrial-500">
                  <span>检测到 {precheck.fieldMapping.detectedFields.length} 个字段</span>
                  <span>·</span>
                  <span className="text-green-600">
                    {Object.values(precheck.fieldMapping.mappedFields).filter(Boolean).length} 已映射
                  </span>
                  <span>·</span>
                  <span className="text-red-600">
                    {precheck.fieldMapping.missingFields.length} 缺失
                  </span>
                </div>
              </div>

              <div className="card p-5">
                <h3 className="section-title flex items-center gap-2">
                  <Clock size={16} className="text-primary-600" />
                  时间解析预览
                </h3>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="p-2 bg-white rounded border border-industrial-200">
                    <p className="text-xs text-industrial-500">当前预设</p>
                    <p className="font-mono text-sm font-bold text-primary-700">
                      {TIME_FORMAT_PRESETS.find(
                        (p) => p.value === precheck.timeParsePreview.config.preset
                      )?.label ?? precheck.timeParsePreview.config.preset}
                    </p>
                  </div>
                  <div className="p-2 bg-white rounded border border-industrial-200">
                    <p className="text-xs text-industrial-500">格式分布</p>
                    <p className="font-mono text-sm font-bold text-industrial-700">
                      {Object.keys(precheck.timeParsePreview.formatDistribution).length} 种
                    </p>
                  </div>
                  <div className="p-2 bg-white rounded border border-industrial-200">
                    <p className="text-xs text-industrial-500">冲突数</p>
                    <p
                      className={`font-mono text-sm font-bold ${
                        precheck.timeParsePreview.conflicts.length > 0
                          ? "text-orange-600"
                          : "text-green-600"
                      }`}
                    >
                      {precheck.timeParsePreview.conflicts.length}
                    </p>
                  </div>
                  <div className="p-2 bg-white rounded border border-industrial-200">
                    <p className="text-xs text-industrial-500">解析错误</p>
                    <p
                      className={`font-mono text-sm font-bold ${
                        precheck.timeParsePreview.parseErrorCount > 0
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {precheck.timeParsePreview.parseErrorCount}
                    </p>
                  </div>
                  <div className="p-2 bg-white rounded border border-industrial-200">
                    <p className="text-xs text-industrial-500">UTF-8 BOM</p>
                    <p
                      className={`font-mono text-sm font-bold ${
                        precheck.validationResult.parseMetadata.hasBOM
                          ? "text-blue-600"
                          : "text-gray-600"
                      }`}
                    >
                      {precheck.validationResult.parseMetadata.hasBOM ? "已检测" : "无"}
                    </p>
                  </div>
                </div>

                {Object.keys(precheck.timeParsePreview.formatDistribution).length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-industrial-500 mb-2">格式分布详情：</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(precheck.timeParsePreview.formatDistribution).map(
                        ([format, count]) => (
                          <span
                            key={format}
                            className="px-2 py-1 bg-industrial-100 text-industrial-700 rounded text-xs"
                          >
                            {format}: {count} 行
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}

                {precheck.timeParsePreview.conflicts.length > 0 && (
                  <div className="mt-4">
                    <button
                      onClick={() => setConflictsExpanded(!conflictsExpanded)}
                      className="flex items-center gap-1.5 text-sm font-medium text-orange-700 hover:text-orange-800 mb-2"
                    >
                      <ShieldAlert size={14} />
                      {precheck.timeParsePreview.conflicts.length} 条时间解析冲突
                      {conflictsExpanded ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                    {conflictsExpanded && (
                      <div className="overflow-auto max-h-72 rounded-lg border border-orange-200">
                        <table className="w-full text-xs">
                          <thead className="bg-orange-50 sticky top-0">
                            <tr className="text-orange-700">
                              <th className="text-left py-2 px-3 w-14">行号</th>
                              <th className="text-left py-2 px-3">原始值</th>
                              <th className="text-left py-2 px-3 w-28">自动格式</th>
                              <th className="text-left py-2 px-3 w-28">手动格式</th>
                              <th className="text-left py-2 px-3">自动结果</th>
                              <th className="text-left py-2 px-3">手动结果</th>
                              <th className="text-left py-2 px-3 w-24">采用规则</th>
                              <th className="text-left py-2 px-3">冲突原因</th>
                            </tr>
                          </thead>
                          <tbody>
                            {precheck.timeParsePreview.conflicts.map((c, i) => (
                              <tr key={c.id || i} className="border-t border-orange-100">
                                <td className="py-1.5 px-3 font-mono text-industrial-600">
                                  {c.rowNumber}
                                </td>
                                <td className="py-1.5 px-3 font-mono text-industrial-700">
                                  {c.rawValue}
                                </td>
                                <td className="py-1.5 px-3">
                                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono">
                                    {c.autoDetectedFormat}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-mono">
                                    {c.userSelectedFormat}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 font-mono text-blue-700 text-[11px]">
                                  {c.autoParsedTimestamp ?? "—"}
                                </td>
                                <td className="py-1.5 px-3 font-mono text-purple-700 text-[11px]">
                                  {c.userParsedTimestamp ?? "—"}
                                </td>
                                <td className="py-1.5 px-3">
                                  <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-mono font-medium">
                                    {c.finalFormatUsed}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 text-orange-700">{c.conflictReason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="card p-5">
                <h3 className="section-title flex items-center gap-2">
                  <ShieldAlert size={16} className="text-primary-600" />
                  异常摘要
                </h3>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <StatChip
                    label="异常总数"
                    value={precheck.anomalySummary.totalAnomalies}
                    color={
                      precheck.anomalySummary.totalAnomalies > 0 ? "orange" : "gray"
                    }
                  />
                  {(
                    Object.entries(precheck.anomalySummary.byType) as Array<
                      [string, number]
                    >
                  ).map(([type, count]) => {
                    const meta = ANOMALY_TYPE_META[type as keyof typeof ANOMALY_TYPE_META];
                    return (
                      <StatChip
                        key={type}
                        label={meta?.name ?? type}
                        value={count}
                        color={count > 0 ? "orange" : "gray"}
                      />
                    );
                  })}
                </div>
                {Object.keys(precheck.anomalySummary.bySensor).length > 0 && (
                  <div>
                    <p className="text-xs text-industrial-500 mb-2">按传感器分布：</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(precheck.anomalySummary.bySensor).map(
                        ([sensor, count]) => (
                          <span
                            key={sensor}
                            className="px-2 py-1 bg-orange-50 text-orange-700 rounded text-xs border border-orange-200"
                          >
                            {sensor}: {count}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="card p-5">
                <h3 className="section-title flex items-center gap-2">
                  <Table2 size={16} className="text-primary-600" />
                  关键列预览（前 10 行）
                </h3>
                <div className="mt-3 overflow-auto rounded-lg border border-industrial-200">
                  <table className="w-full text-xs">
                    <thead className="bg-industrial-50 sticky top-0">
                      <tr className="text-industrial-600">
                        <th className="text-left py-2 px-3 w-14">行号</th>
                        <th className="text-left py-2 px-3">原始时间戳</th>
                        <th className="text-left py-2 px-3">标准化时间</th>
                        <th className="text-left py-2 px-3">传感器</th>
                        <th className="text-left py-2 px-3 w-24">数值</th>
                        <th className="text-left py-2 px-3 w-28">时间格式</th>
                        <th className="text-left py-2 px-3">说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {precheck.keyColumnsPreview.slice(0, 10).map((row) => (
                        <tr key={row.rowNumber} className="border-t border-industrial-100">
                          <td className="py-1.5 px-3 font-mono text-industrial-500">
                            {row.rowNumber}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-industrial-700">
                            {row.rawTimestamp}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-green-700">
                            {row.standardizedTimestamp}
                          </td>
                          <td className="py-1.5 px-3 text-industrial-700">
                            {row.sensorName}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-industrial-800">
                            {row.value}
                          </td>
                          <td className="py-1.5 px-3">
                            <span className="px-1.5 py-0.5 rounded bg-industrial-100 text-industrial-600 font-mono">
                              {row.timeFormatUsed}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-xs text-industrial-500 max-w-xs truncate">
                            {row.parseNote || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

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

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
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
                <StatChip
                  label="UTF-8 BOM"
                  value={validation.parseMetadata?.hasBOM ? "是" : "否"}
                  color={validation.parseMetadata?.hasBOM ? "blue" : "gray"}
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
              {sourceType === "csv" ? "CSV" : "JSON"} 格式说明
            </h3>
            <div className="text-xs text-industrial-600 space-y-1">
              {sourceType === "csv" ? (
                <>
                  <p>
                    <code className="px-1.5 py-0.5 bg-white rounded font-mono border">
                      timestamp, sensorName, value
                    </code>
                  </p>
                  <p>
                    时间戳支持格式: YYYY-MM-DD HH:mm:ss、YYYY/MM/DD HH:mm:ss、ISO
                    8601、Unix 时间戳（秒/毫秒）、自定义格式
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <code className="px-1.5 py-0.5 bg-white rounded font-mono border">
                      [{" { timestamp, sensorName, value } "}, ...]
                    </code>
                  </p>
                  <p>
                    也支持 {"{"} data: [...] {"}"} 或 {"{"} records: [...] {"}"} 结构
                  </p>
                </>
              )}
              <p>
                sensorName 必须与规则配置中的传感器名称完全匹配，否则将提示「未知传感器」
              </p>
              <p className="text-primary-600 font-medium">
                🆕 导出的报告将包含：原始时间戳、标准化时间、时间格式说明、解析冲突日志
              </p>
              <p className="text-blue-600 font-medium">
                ℹ️ 支持带 UTF-8 BOM 的 Windows 格式文件，会自动检测并处理
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="card p-4 flex items-center justify-between bg-blue-50/50 border-blue-100">
            <div>
              <p className="text-sm font-medium text-industrial-800">
                历史批次管理
              </p>
              <p className="text-xs text-industrial-500">
                共 {batchList.length} 个批次，支持撤销和重导
              </p>
            </div>
            <button
              onClick={() => loadBatchList()}
              className="btn-secondary text-xs"
            >
              <RefreshCw size={14} /> 刷新
            </button>
          </div>

          {batchList.length === 0 ? (
            <div className="card p-10 text-center">
              <History size={40} className="mx-auto text-industrial-300 mb-3" />
              <p className="text-industrial-500">暂无历史批次</p>
              <button
                onClick={() => setActiveTab("import")}
                className="btn-primary mt-4 text-xs"
              >
                <Play size={14} /> 开始导入
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {batchList.map((batch) => (
                <div
                  key={batch.id}
                  className="card p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-semibold text-industrial-800 font-mono">
                          {batch.batchNo}
                        </h4>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            batch.status === "completed"
                              ? "bg-green-100 text-green-700"
                              : batch.status === "reviewing"
                              ? "bg-blue-100 text-blue-700"
                              : batch.status === "rolled_back"
                              ? "bg-gray-100 text-gray-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
                          {batch.status === "completed"
                            ? "已完成"
                            : batch.status === "reviewing"
                            ? "复核中"
                            : batch.status === "rolled_back"
                            ? "已回滚"
                            : batch.status}
                        </span>
                        {batch.parseMetadata?.hasBOM && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            UTF-8 BOM
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-xs text-industrial-600">
                        <div>
                          <span className="text-industrial-400">数据量：</span>
                          <span className="font-mono">{batch.totalRows}</span>
                        </div>
                        <div>
                          <span className="text-industrial-400">导入时间：</span>
                          <span>{new Date(batch.importedAt).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-industrial-400">备注：</span>
                          <span>{batch.note || "-"}</span>
                        </div>
                        <div>
                          <span className="text-industrial-400">规则版本：</span>
                          <span className="font-mono">v{ruleVersions.find(r => r.id === batch.ruleVersionId)?.version || "?"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => navigate(`/review/${batch.id}`)}
                        className="btn-secondary text-xs"
                        title="查看详情"
                      >
                        <FileText size={14} />
                      </button>
                      <button
                        onClick={() => navigate(`/report/${batch.id}`)}
                        className="btn-secondary text-xs"
                        title="查看报告"
                      >
                        <FileJson size={14} />
                      </button>
                      <button
                        onClick={() => handleReimport(batch.id, batch.batchNo)}
                        className="btn-secondary text-xs text-orange-600 hover:text-orange-700"
                        title="重新导入"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => handleRollback(batch.id, batch.batchNo)}
                        className="btn-secondary text-xs text-red-600 hover:text-red-700"
                        title="撤销（删除）"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "logs" && (
        <div className="space-y-4">
          <div className="card p-4 flex items-center justify-between bg-blue-50/50 border-blue-100">
            <div>
              <p className="text-sm font-medium text-industrial-800">
                操作日志
              </p>
              <p className="text-xs text-industrial-500">
                记录所有导入操作、采用规则、受影响记录和失败原因
              </p>
            </div>
            <button
              onClick={refreshLogs}
              className="btn-secondary text-xs"
              disabled={refreshingLogs}
            >
              <RefreshCw size={14} className={refreshingLogs ? "animate-spin" : ""} /> 刷新
            </button>
          </div>

          {operationLogs.length === 0 ? (
            <div className="card p-10 text-center">
              <FileWarning size={40} className="mx-auto text-industrial-300 mb-3" />
              <p className="text-industrial-500">暂无操作日志</p>
            </div>
          ) : (
            <div className="space-y-3">
              {operationLogs.map((log) => (
                <div
                  key={log.id}
                  className={`card p-4 border-l-4 ${
                    log.status === "completed"
                      ? "border-l-green-500"
                      : log.status === "failed"
                      ? "border-l-red-500"
                      : log.status === "rolling_back" || log.status === "rolled_back"
                      ? "border-l-orange-500"
                      : "border-l-blue-500"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            log.status === "completed"
                              ? "bg-green-100 text-green-700"
                              : log.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : log.status === "rolling_back" || log.status === "rolled_back"
                              ? "bg-orange-100 text-orange-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {log.status === "completed"
                            ? "成功"
                            : log.status === "failed"
                            ? "失败"
                            : log.status === "rolling_back"
                            ? "回滚中"
                            : log.status === "rolled_back"
                            ? "已回滚"
                            : log.status}
                        </span>
                        <span className="font-semibold text-industrial-800 font-mono">
                          {log.sourceName}
                        </span>
                        {log.batchNo && (
                          <span className="text-xs text-industrial-500 font-mono">
                            批次: {log.batchNo}
                          </span>
                        )}
                        {log.hasBOM && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            UTF-8 BOM
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-industrial-600 space-y-1">
                        <div>
                          <span className="text-industrial-400">时间：</span>
                          {new Date(log.startedAt).toLocaleString()}
                          {log.completedAt && (
                            <span className="text-industrial-400 ml-2">
                              （耗时: {((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000).toFixed(2)}s）
                            </span>
                          )}
                        </div>
                        <div>
                          <span className="text-industrial-400">记录：</span>
                          总计 {log.recordCounts.totalRows}，
                          有效 {log.recordCounts.validRows}，
                          无效 {log.recordCounts.invalidRows}，
                          跳过 {log.recordCounts.skippedRows}，
                          导入 {log.recordCounts.importedRows}
                        </div>
                        {log.adoptedRules.length > 0 && (
                          <div>
                            <span className="text-industrial-400">采用规则：</span>
                            {log.adoptedRules.map((rule, i) => (
                              <span key={i} className="ml-1">
                                <span className="bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded">
                                  {rule.ruleDescription}（{rule.affectedRecords}条）
                                </span>
                                {i < log.adoptedRules.length - 1 && " "}
                              </span>
                            ))}
                          </div>
                        )}
                        {log.conflicts.length > 0 && (
                          <div>
                            <span className="text-industrial-400">冲突：</span>
                            <span className="text-orange-600">{log.conflicts.length} 条</span>
                          </div>
                        )}
                        {log.errorCategory && (
                          <div className="text-red-600">
                            <span className="text-industrial-400">错误：</span>
                            {log.errorCategory} - {log.errorMessage}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
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
      <p className="text-lg font-bold font-mono">
        {typeof value === "number" ? formatNumber(value, 0) : value}
      </p>
    </div>
  );
}
