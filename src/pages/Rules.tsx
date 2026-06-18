import { useState, useEffect } from "react";
import {
  Settings2,
  Plus,
  Trash2,
  Save,
  Clock,
  Thermometer,
  Cpu,
  AlertTriangle,
  Check,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type {
  Device,
  MissingRule,
  RuleVersion,
  SensorRule,
} from "@/types";
import { generateId, formatTimestamp } from "@/utils/statistics";

export default function Rules() {
  const { ruleVersions, currentRuleVersionId, selectRuleVersion, createRuleVersion, initStore, pushToast } =
    useAppStore();

  const [name, setName] = useState("默认质检规则");
  const [description, setDescription] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [sensorRules, setSensorRules] = useState<SensorRule[]>([]);
  const [missingRules, setMissingRules] = useState<MissingRule[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    initStore();
  }, [initStore]);

  useEffect(() => {
    const current = ruleVersions.find((r) => r.id === currentRuleVersionId);
    if (current) {
      setName(current.name);
      setDescription(current.description);
      setDevices(JSON.parse(JSON.stringify(current.devices)));
      setSensorRules(JSON.parse(JSON.stringify(current.sensorRules)));
      setMissingRules(JSON.parse(JSON.stringify(current.missingRules)));
    }
  }, [currentRuleVersionId, ruleVersions]);

  const addDevice = () => {
    const newDev: Device = {
      id: generateId("dev"),
      name: "新设备",
      code: "DEV-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
    };
    setDevices([...devices, newDev]);
  };

  const updateDevice = (id: string, patch: Partial<Device>) => {
    setDevices(devices.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDevice = (id: string) => {
    setDevices(devices.filter((d) => d.id !== id));
    setSensorRules(sensorRules.filter((s) => s.deviceId !== id));
  };

  const addSensorRule = () => {
    if (devices.length === 0) {
      pushToast("warning", "请先添加一个设备");
      return;
    }
    const newSr: SensorRule = {
      id: generateId("sr"),
      deviceId: devices[0].id,
      sensorName: "New_Sensor",
      minValue: 0,
      maxValue: 100,
      jumpThreshold: 20,
      unit: "",
    };
    setSensorRules([...sensorRules, newSr]);
  };

  const updateSensorRule = (id: string, patch: Partial<SensorRule>) => {
    setSensorRules(sensorRules.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSensorRule = (id: string) => {
    setSensorRules(sensorRules.filter((s) => s.id !== id));
  };

  const addMissingRule = () => {
    const existingSensorNames = new Set(sensorRules.map((s) => s.sensorName));
    const firstSensor = sensorRules[0]?.sensorName ?? "Sensor";
    if (existingSensorNames.size === 0) {
      pushToast("warning", "请先添加传感器规则");
      return;
    }
    const newMr: MissingRule = {
      id: generateId("mr"),
      sensorName: firstSensor,
      maxGapSeconds: 120,
      maxConsecutiveMissing: 2,
    };
    setMissingRules([...missingRules, newMr]);
  };

  const updateMissingRule = (id: string, patch: Partial<MissingRule>) => {
    setMissingRules(missingRules.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const removeMissingRule = (id: string) => {
    setMissingRules(missingRules.filter((m) => m.id !== id));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      pushToast("error", "规则名称不能为空");
      return;
    }
    if (sensorRules.length === 0) {
      pushToast("error", "至少需要配置一条传感器规则");
      return;
    }
    const names = new Set<string>();
    for (const sr of sensorRules) {
      if (names.has(sr.sensorName)) {
        pushToast("error", `传感器名称重复: ${sr.sensorName}`);
        return;
      }
      names.add(sr.sensorName);
      if (sr.minValue >= sr.maxValue) {
        pushToast("error", `${sr.sensorName}: 最小值必须小于最大值`);
        return;
      }
    }

    setSaving(true);
    try {
      await createRuleVersion({
        name: name.trim(),
        description: description.trim(),
        devices,
        sensorRules,
        missingRules,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-industrial-900 flex items-center gap-2">
            <Settings2 size={22} className="text-orange-500" />
            规则配置
          </h1>
          <p className="mt-1 text-sm text-industrial-500">
            管理设备、传感器范围、跳变阈值和缺失规则
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={currentRuleVersionId ?? ""}
            onChange={(e) => selectRuleVersion(e.target.value)}
            className="input !w-auto"
          >
            {ruleVersions.map((rv) => (
              <option key={rv.id} value={rv.id}>
                {rv.name} · v{rv.version}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
          >
            <Save size={16} />
            {saving ? "保存中..." : "保存为新版本"}
          </button>
        </div>
      </div>

      {ruleVersions.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-industrial-700 mb-3 flex items-center gap-2">
            <Clock size={16} className="text-industrial-400" />
            版本历史
          </h3>
          <div className="flex flex-wrap gap-2">
            {ruleVersions.map((rv) => (
              <div
                key={rv.id}
                className={`px-3 py-1.5 rounded-md border text-xs cursor-pointer transition ${
                  rv.id === currentRuleVersionId
                    ? "bg-primary-50 border-primary-300 text-primary-700"
                    : "bg-white border-industrial-200 text-industrial-600 hover:bg-industrial-50"
                }`}
                onClick={() => selectRuleVersion(rv.id)}
              >
                <div className="font-semibold">{rv.name}</div>
                <div className="text-industrial-400">
                  v{rv.version} · {formatTimestamp(rv.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title !mb-0">
              <Cpu size={18} className="text-blue-500" />
              基本信息 & 设备
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">规则名称</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="label">规则描述</label>
              <textarea
                className="input min-h-[72px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述规则的使用场景..."
              />
            </div>

            <div className="flex items-center justify-between mt-4">
              <label className="label !mb-0">设备列表</label>
              <button onClick={addDevice} className="btn-ghost text-xs">
                <Plus size={14} /> 添加设备
              </button>
            </div>

            {devices.length === 0 ? (
              <div className="text-center py-6 text-xs text-industrial-400 border border-dashed rounded-lg">
                暂无设备，点击上方按钮添加
              </div>
            ) : (
              <div className="space-y-2">
                {devices.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 p-2.5 bg-industrial-50 rounded-lg"
                  >
                    <input
                      className="input !py-1.5 flex-1"
                      value={d.name}
                      onChange={(e) => updateDevice(d.id, { name: e.target.value })}
                      placeholder="设备名称"
                    />
                    <input
                      className="input !py-1.5 w-32 font-mono text-xs"
                      value={d.code}
                      onChange={(e) => updateDevice(d.id, { code: e.target.value })}
                      placeholder="编号"
                    />
                    <button
                      onClick={() => removeDevice(d.id)}
                      className="btn-ghost !p-1.5 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title !mb-0">
              <Thermometer size={18} className="text-red-500" />
              传感器规则
            </h3>
            <button onClick={addSensorRule} className="btn-secondary text-xs">
              <Plus size={14} /> 添加传感器
            </button>
          </div>

          {sensorRules.length === 0 ? (
            <div className="text-center py-10 text-xs text-industrial-400 border border-dashed rounded-lg">
              暂无传感器规则
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-industrial-200 text-industrial-500 text-xs">
                    <th className="text-left py-2 px-2 font-medium">设备</th>
                    <th className="text-left py-2 px-2 font-medium">传感器名称</th>
                    <th className="text-right py-2 px-2 font-medium w-24">最小值</th>
                    <th className="text-right py-2 px-2 font-medium w-24">最大值</th>
                    <th className="text-right py-2 px-2 font-medium w-28">跳变阈值</th>
                    <th className="text-left py-2 px-2 font-medium w-20">单位</th>
                    <th className="text-right py-2 px-2 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {sensorRules.map((sr) => (
                    <tr key={sr.id} className="border-b border-industrial-100">
                      <td className="py-2 px-2">
                        <select
                          className="input !py-1.5 text-xs"
                          value={sr.deviceId}
                          onChange={(e) => updateSensorRule(sr.id, { deviceId: e.target.value })}
                        >
                          {devices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          className="input !py-1.5 font-mono text-xs"
                          value={sr.sensorName}
                          onChange={(e) => updateSensorRule(sr.id, { sensorName: e.target.value })}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="any"
                          className="input !py-1.5 text-right font-mono text-xs"
                          value={sr.minValue}
                          onChange={(e) => updateSensorRule(sr.id, { minValue: Number(e.target.value) })}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="any"
                          className="input !py-1.5 text-right font-mono text-xs"
                          value={sr.maxValue}
                          onChange={(e) => updateSensorRule(sr.id, { maxValue: Number(e.target.value) })}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="any"
                          className="input !py-1.5 text-right font-mono text-xs"
                          value={sr.jumpThreshold}
                          onChange={(e) => updateSensorRule(sr.id, { jumpThreshold: Number(e.target.value) })}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          className="input !py-1.5 text-xs"
                          value={sr.unit}
                          onChange={(e) => updateSensorRule(sr.id, { unit: e.target.value })}
                          placeholder="℃"
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <button
                          onClick={() => removeSensorRule(sr.id)}
                          className="btn-ghost !p-1.5 text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title !mb-0">
              <AlertTriangle size={18} className="text-orange-500" />
              数据缺失规则
            </h3>
            <button onClick={addMissingRule} className="btn-secondary text-xs">
              <Plus size={14} /> 添加缺失规则
            </button>
          </div>

          {missingRules.length === 0 ? (
            <div className="text-center py-6 text-xs text-industrial-400 border border-dashed rounded-lg">
              未配置缺失规则，将使用默认阈值（最大间隔 60 秒）
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-industrial-200 text-industrial-500 text-xs">
                    <th className="text-left py-2 px-2 font-medium">传感器</th>
                    <th className="text-right py-2 px-2 font-medium w-48">最大时间间隔 (秒)</th>
                    <th className="text-right py-2 px-2 font-medium w-48">连续缺失点数阈值</th>
                    <th className="text-right py-2 px-2 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {missingRules.map((mr) => (
                    <tr key={mr.id} className="border-b border-industrial-100">
                      <td className="py-2 px-2">
                        <select
                          className="input !py-1.5 font-mono text-xs"
                          value={mr.sensorName}
                          onChange={(e) => updateMissingRule(mr.id, { sensorName: e.target.value })}
                        >
                          {sensorRules.map((s) => (
                            <option key={s.id} value={s.sensorName}>
                              {s.sensorName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min={1}
                          className="input !py-1.5 text-right font-mono text-xs"
                          value={mr.maxGapSeconds}
                          onChange={(e) => updateMissingRule(mr.id, { maxGapSeconds: Number(e.target.value) })}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min={1}
                          className="input !py-1.5 text-right font-mono text-xs"
                          value={mr.maxConsecutiveMissing}
                          onChange={(e) => updateMissingRule(mr.id, { maxConsecutiveMissing: Number(e.target.value) })}
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <button
                          onClick={() => removeMissingRule(mr.id)}
                          className="btn-ghost !p-1.5 text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
