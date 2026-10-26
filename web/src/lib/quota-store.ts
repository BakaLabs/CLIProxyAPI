import dayjs from "dayjs";
import type { AuthFileEntry } from "@/api/types";

export const LOCAL_STORAGE_QUOTA_KEY = "cpa-credential-quotas";

export interface CachedManualQuota {
  data: unknown;
  fetchedAt: number;
  baseSuccess?: number;
  baseFailed?: number;
  baseTotal?: number;
}

export interface RawQuotaBucket {
  window?: string;
  remainingFraction?: number;
  remaining_fraction?: number;
  remaining_percent?: number;
  used_percent?: number;
  resetTime?: string | number;
  reset_time?: string | number;
  description?: string;
  displayName?: string;
}

export interface RawQuotaGroup {
  displayName?: string;
  buckets?: RawQuotaBucket[];
}

export interface RawQuotaPayload {
  subscription?: { plan?: string; title?: string };
  plan?: string;
  groups?: RawQuotaGroup[];
  buckets?: RawQuotaBucket[];
  remaining_percent?: number;
  remainingFraction?: number;
  reset_time?: string;
  reset_at?: string;
  active_resets?: string | number;
}

export interface ResolvedQuota {
  plan: string;
  windowLabel: string;
  remainingPct: number | null;
  isKnown: boolean;
  isUpstream: boolean;
  isEstimated: boolean;
  resetTime?: string;
  activeResets: string | number;
  newRequests: number;
  fetchedAt?: number;
}

export function formatQuotaResetTime(raw: string | number | undefined | null): string {
  if (!raw) return "";
  const d = typeof raw === "number" ? (raw < 1e11 ? dayjs.unix(raw) : dayjs(raw)) : dayjs(raw);
  if (!d.isValid()) return String(raw);
  return d.format("MM/DD HH:mm");
}

export function capitalize(s?: string): string {
  if (!s) return "Free";
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Loads all cached quotas from localStorage safely.
 */
export function loadCachedQuotas(): Record<string, CachedManualQuota> {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_QUOTA_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, CachedManualQuota>;
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return {};
}

/**
 * Persists a newly fetched upstream quota record under all related identifier keys.
 */
export function saveCachedQuota(
  keys: (string | undefined)[],
  data: unknown,
  baseSuccess = 0,
  baseFailed = 0
): void {
  if (!data) return;
  const current = loadCachedQuotas();
  const record: CachedManualQuota = {
    data,
    fetchedAt: Date.now(),
    baseSuccess,
    baseFailed,
    baseTotal: baseSuccess + baseFailed,
  };

  const validKeys = keys.filter((k): k is string => typeof k === "string" && k.trim() !== "");
  if (validKeys.length === 0) return;

  for (const k of validKeys) {
    current[k] = record;
  }

  try {
    localStorage.setItem(LOCAL_STORAGE_QUOTA_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent("cpa-quota-updated", { detail: { keys: validKeys } }));
  } catch {
    // Ignore storage write errors
  }
}

/**
 * Synchronizes backend manual_quota records into local cache if missing or newer.
 */
export function syncCachedQuotasFromEntries(entries: AuthFileEntry[]): void {
  if (!entries || entries.length === 0) return;
  const current = loadCachedQuotas();
  let changed = false;

  for (const entry of entries) {
    if (!entry.manual_quota || entry.manual_quota.data === undefined || entry.manual_quota.data === null) {
      continue;
    }
    const backendFetchedAt = entry.manual_quota.fetched_at
      ? new Date(entry.manual_quota.fetched_at).getTime()
      : 0;

    const keys = [entry.auth_index, entry.id, entry.name].filter(
      (k): k is string => typeof k === "string" && k.trim() !== ""
    );

    for (const key of keys) {
      const local = current[key];
      if (!local || backendFetchedAt > (local.fetchedAt ?? 0)) {
        current[key] = {
          data: entry.manual_quota.data,
          fetchedAt: backendFetchedAt,
          baseSuccess: entry.manual_quota.base_success ?? 0,
          baseFailed: entry.manual_quota.base_failed ?? 0,
          baseTotal: (entry.manual_quota.base_success ?? 0) + (entry.manual_quota.base_failed ?? 0),
        };
        changed = true;
      }
    }
  }

  if (changed) {
    try {
      localStorage.setItem(LOCAL_STORAGE_QUOTA_KEY, JSON.stringify(current));
      window.dispatchEvent(new CustomEvent("cpa-quota-updated"));
    } catch {
      // Ignore storage write errors
    }
  }
}

/**
 * Retrieves the cached quota for an entry from either backend manual_quota or localStorage.
 */
export function getCachedQuota(
  entry: AuthFileEntry,
  localCache?: Record<string, CachedManualQuota>
): CachedManualQuota | undefined {
  const cache = localCache ?? loadCachedQuotas();
  const keys = [entry.auth_index, entry.id, entry.name].filter(
    (k): k is string => typeof k === "string" && k.trim() !== ""
  );

  let localRecord: CachedManualQuota | undefined;
  for (const k of keys) {
    if (cache[k]?.data !== undefined && cache[k]?.data !== null) {
      localRecord = cache[k];
      break;
    }
  }

  if (entry.manual_quota && entry.manual_quota.data !== undefined && entry.manual_quota.data !== null) {
    const backendFetchedAt = entry.manual_quota.fetched_at
      ? new Date(entry.manual_quota.fetched_at).getTime()
      : 0;
    const backendRecord: CachedManualQuota = {
      data: entry.manual_quota.data,
      fetchedAt: backendFetchedAt,
      baseSuccess: entry.manual_quota.base_success ?? 0,
      baseFailed: entry.manual_quota.base_failed ?? 0,
      baseTotal: (entry.manual_quota.base_success ?? 0) + (entry.manual_quota.base_failed ?? 0),
    };

    if (!localRecord || backendFetchedAt >= (localRecord.fetchedAt ?? 0)) {
      return backendRecord;
    }
  }

  return localRecord;
}

/**
 * Resolves credential quota strictly based on manual upstream quota fetches.
 * - If no manual quota is recorded: returns unknown quota (remainingPct = null).
 * - If manual quota is recorded:
 *   If no requests have been recorded since fetch: displays authoritative upstream quota.
 *   If new requests have occurred: deducts usage estimation from cached quota until next manual fetch.
 */
export function resolveCredentialQuota(
  entry: AuthFileEntry,
  cachedQuota?: CachedManualQuota
): ResolvedQuota {
  const activeResets =
    entry.active_resets !== undefined && entry.active_resets !== null
      ? entry.active_resets
      : "未记录";

  // If manual quota has never been fetched / recorded, display unknown quota.
  if (!cachedQuota || cachedQuota.data === undefined || cachedQuota.data === null) {
    return {
      plan: capitalize(entry.plan_type || entry.account_type || "未知"),
      windowLabel: "未知额度",
      remainingPct: null,
      isKnown: false,
      isUpstream: false,
      isEstimated: false,
      resetTime: "",
      activeResets,
      newRequests: 0,
    };
  }

  // Parse upstream payload
  const raw = cachedQuota.data as RawQuotaPayload;
  const sub = (typeof raw === "object" && raw !== null ? raw.subscription : undefined) || {};
  const plan = capitalize(sub.plan || sub.title || raw?.plan || entry.plan_type || entry.account_type || "Free");

  let targetBucket: RawQuotaBucket | null = null;
  if (Array.isArray(raw?.groups)) {
    for (const grp of raw.groups) {
      if (Array.isArray(grp.buckets)) {
        for (const b of grp.buckets) {
          const fracB =
            b.remainingFraction ??
            b.remaining_fraction ??
            (b.remaining_percent !== undefined ? b.remaining_percent / 100 : undefined);
          const fracTarget = targetBucket
            ? (targetBucket.remainingFraction ??
              targetBucket.remaining_fraction ??
              (targetBucket.remaining_percent !== undefined ? targetBucket.remaining_percent / 100 : 1))
            : 1;
          if (!targetBucket || (fracB !== undefined && fracB < fracTarget)) {
            targetBucket = b;
          }
        }
      }
    }
  }
  if (!targetBucket && Array.isArray(raw?.buckets) && raw.buckets.length > 0) {
    for (const b of raw.buckets) {
      const fracB =
        b.remainingFraction ??
        b.remaining_fraction ??
        (b.remaining_percent !== undefined ? b.remaining_percent / 100 : undefined);
      const fracTarget = targetBucket
        ? (targetBucket.remainingFraction ??
          targetBucket.remaining_fraction ??
          (targetBucket.remaining_percent !== undefined ? targetBucket.remaining_percent / 100 : 1))
        : 1;
      if (!targetBucket || (fracB !== undefined && fracB < fracTarget)) {
        targetBucket = b;
      }
    }
  }

  let cachedPct = 100;
  let windowLabel = "周期限额";
  let resetTime = "";

  if (targetBucket) {
    const frac = targetBucket.remainingFraction ?? targetBucket.remaining_fraction;
    if (frac !== undefined) {
      cachedPct = Math.max(0, Math.min(100, frac <= 1 ? Math.round(frac * 100) : Math.round(frac)));
    } else if (targetBucket.remaining_percent !== undefined) {
      cachedPct = Math.max(0, Math.min(100, Math.round(targetBucket.remaining_percent)));
    }

    const rawWindow = String(targetBucket.window || targetBucket.description || "");
    if (rawWindow.toLowerCase().includes("5h") || rawWindow.toLowerCase().includes("300") || rawWindow.includes("5小时")) {
      windowLabel = "5小时限额";
    } else if (rawWindow.toLowerCase().includes("week") || rawWindow.toLowerCase().includes("7d") || rawWindow.includes("周")) {
      windowLabel = "周限额";
    } else if (rawWindow.toLowerCase().includes("day") || rawWindow.toLowerCase().includes("24h") || rawWindow.includes("日")) {
      windowLabel = "日限额";
    } else if (rawWindow.toLowerCase().includes("month") || rawWindow.includes("月")) {
      windowLabel = "月限额";
    } else if (rawWindow) {
      windowLabel = rawWindow;
    }

    resetTime = formatQuotaResetTime(targetBucket.resetTime || targetBucket.reset_time || raw?.reset_time);
  } else if (raw?.remaining_percent !== undefined || raw?.remainingFraction !== undefined) {
    const val = Number(raw.remaining_percent ?? raw.remainingFraction);
    cachedPct = Math.max(0, Math.min(100, val <= 1 ? Math.round(val * 100) : Math.round(val)));
    windowLabel = "月限额";
    resetTime = formatQuotaResetTime(raw.reset_time || raw.reset_at);
  }

  // Calculate usage delta from recorded proxy request counts
  const currentSuccess = entry.success ?? 0;
  const currentFailed = entry.failed ?? 0;
  const currentTotal = currentSuccess + currentFailed;

  const baseSuccess = cachedQuota.baseSuccess ?? 0;
  const baseFailed = cachedQuota.baseFailed ?? 0;
  const baseTotal = cachedQuota.baseTotal !== undefined ? cachedQuota.baseTotal : (baseSuccess + baseFailed);

  const newRequests = Math.max(0, currentTotal - baseTotal);
  const upstreamResets = raw?.active_resets !== undefined ? raw.active_resets : activeResets;

  if (newRequests === 0) {
    return {
      plan,
      windowLabel,
      remainingPct: cachedPct,
      isKnown: true,
      isUpstream: true,
      isEstimated: false,
      resetTime,
      activeResets: upstreamResets,
      newRequests: 0,
      fetchedAt: cachedQuota.fetchedAt,
    };
  }

  // Deduct estimated usage from cached baseline based on new recorded requests
  let capacity = 100;
  const winLower = windowLabel.toLowerCase();
  const isShortWindow =
    winLower.includes("5小时") ||
    winLower.includes("5h") ||
    winLower.includes("日") ||
    winLower.includes("day");

  if (isShortWindow) {
    if (plan === "Plus") capacity = 40;
    else if (plan === "Pro" || plan === "Team" || plan === "Max") capacity = 100;
    else capacity = 20;
  } else {
    if (plan === "Plus") capacity = 200;
    else if (plan === "Pro" || plan === "Team" || plan === "Max") capacity = 500;
    else capacity = 50;
  }

  const pctDeducted = (newRequests / capacity) * 100;
  const displayedRemainingPct = Math.max(0, Math.round(cachedPct - pctDeducted));

  return {
    plan,
    windowLabel,
    remainingPct: displayedRemainingPct,
    isKnown: true,
    isUpstream: false,
    isEstimated: true,
    resetTime,
    activeResets: upstreamResets,
    newRequests,
    fetchedAt: cachedQuota.fetchedAt,
  };
}
