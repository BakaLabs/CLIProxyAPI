import { create } from "zustand";

export type TimeRangePreset = "1h" | "6h" | "24h" | "7d" | "30d" | "custom";

export interface TimeRange {
  preset: TimeRangePreset;
  /** Absolute bounds (unix ms) when preset === "custom". */
  from?: number;
  to?: number;
}

interface PrefsState {
  locale: "en" | "zh-CN";
  defaultRange: TimeRangePreset;
  maskApiKeys: boolean;
  sidebarCollapsed: boolean;
  setLocale: (locale: "en" | "zh-CN") => void;
  setDefaultRange: (preset: TimeRangePreset) => void;
  setMaskApiKeys: (mask: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

function load<T extends string>(storageKey: string, fallback: T): T {
  return (localStorage.getItem(storageKey) as T | null) ?? fallback;
}

function persist(storageKey: string, value: string) {
  localStorage.setItem(storageKey, value);
}

export const usePrefsStore = create<PrefsState>((set) => ({
  locale: load("cpa-locale", navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en"),
  defaultRange: load<TimeRangePreset>("cpa-range", "24h"),
  maskApiKeys: localStorage.getItem("cpa-mask-keys") !== "0",
  sidebarCollapsed: localStorage.getItem("cpa-sidebar-collapsed") === "1",
  setLocale: (locale) => {
    persist("cpa-locale", locale);
    set({ locale });
  },
  setDefaultRange: (preset) => {
    persist("cpa-range", preset);
    set({ defaultRange: preset });
  },
  setMaskApiKeys: (mask) => {
    persist("cpa-mask-keys", mask ? "1" : "0");
    set({ maskApiKeys: mask });
  },
  setSidebarCollapsed: (collapsed) => {
    persist("cpa-sidebar-collapsed", collapsed ? "1" : "0");
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar: () => {
    set((state) => {
      const next = !state.sidebarCollapsed;
      persist("cpa-sidebar-collapsed", next ? "1" : "0");
      return { sidebarCollapsed: next };
    });
  },
}));

/** Resolve a range preset into absolute unix-ms bounds. */
export function resolveRange(range: TimeRange, now = Date.now()): { from: number; to: number } {
  switch (range.preset) {
    case "1h":
      return { from: now - 3_600_000, to: now };
    case "6h":
      return { from: now - 6 * 3_600_000, to: now };
    case "7d":
      return { from: now - 7 * 86_400_000, to: now };
    case "30d":
      return { from: now - 30 * 86_400_000, to: now };
    case "custom":
      return { from: range.from ?? now - 86_400_000, to: range.to ?? now };
    case "24h":
    default:
      return { from: now - 86_400_000, to: now };
  }
}
