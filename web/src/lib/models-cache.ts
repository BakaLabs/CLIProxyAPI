export const LOCAL_STORAGE_MODELS_KEY = "cpa-credential-models";

export interface CachedCredentialModels {
  models: string[];
  syncedAt?: number;
}

export function loadCachedModelsMap(): Record<string, CachedCredentialModels> {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_MODELS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, CachedCredentialModels>;
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return {};
}

export function saveCachedModels(
  keys: (string | undefined)[],
  models: string[],
  syncedAt = Date.now()
): void {
  if (!models || models.length === 0) return;
  const current = loadCachedModelsMap();
  const entry: CachedCredentialModels = {
    models,
    syncedAt,
  };
  for (const k of keys) {
    if (k && String(k).trim()) {
      current[String(k).trim()] = entry;
    }
  }
  try {
    localStorage.setItem(LOCAL_STORAGE_MODELS_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
}

export function getCachedModels(key?: string): string[] | null {
  if (!key) return null;
  const all = loadCachedModelsMap();
  const entry = all[key.trim()];
  if (!entry || !Array.isArray(entry.models)) return null;
  return entry.models;
}
