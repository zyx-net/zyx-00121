import type { TimeParseConfig, PerSourceTimeConfigEntry } from "@/types";
import { loadTimeParseConfig, saveTimeParseConfig } from "@/utils/csvParser";

const STORAGE_PREFIX = "sensor_qa_time_config_";
const INDEX_KEY = "sensor_qa_time_config_index";

export function generateSourceId(filename: string): string {
  const sanitized = filename
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  let hash = 0;
  for (let i = 0; i < sanitized.length; i++) {
    const ch = sanitized.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  const hashStr = (hash >>> 0).toString(36);
  return sanitized.slice(0, 48) + "_" + hashStr;
}

function loadIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveIndex(ids: string[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
}

export function savePerSourceConfig(
  filename: string,
  config: TimeParseConfig
): void {
  const sourceId = generateSourceId(filename);
  const entry: PerSourceTimeConfigEntry = {
    sourceId,
    sourceName: filename,
    config,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_PREFIX + sourceId, JSON.stringify(entry));

  const index = loadIndex();
  if (!index.includes(sourceId)) {
    index.push(sourceId);
    saveIndex(index);
  }
}

export function loadPerSourceConfig(
  filename: string
): TimeParseConfig {
  const sourceId = generateSourceId(filename);
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sourceId);
    if (raw) {
      const entry: PerSourceTimeConfigEntry = JSON.parse(raw);
      return entry.config;
    }
  } catch {}
  return loadTimeParseConfig();
}

export function listPerSourceConfigs(): PerSourceTimeConfigEntry[] {
  const index = loadIndex();
  const entries: PerSourceTimeConfigEntry[] = [];
  for (const id of index) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + id);
      if (raw) {
        entries.push(JSON.parse(raw));
      }
    } catch {}
  }
  return entries;
}

export function deletePerSourceConfig(filename: string): void {
  const sourceId = generateSourceId(filename);
  localStorage.removeItem(STORAGE_PREFIX + sourceId);
  const index = loadIndex().filter((id) => id !== sourceId);
  saveIndex(index);
}
