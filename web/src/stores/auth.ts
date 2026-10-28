import { create } from "zustand";

const STORAGE_KEY = "cpa-dashboard-auth";

// Legacy CPA management center storage constants used by built-in and third-party plugins
// (e.g. freetier2api, workbuddy, clinepassbridge, qoderwork, cpa-codex-candy-eval).
const LEGACY_STORAGE_KEY_AUTH = "cli-proxy-auth";
const LEGACY_STORAGE_KEY_LOGGED_IN = "isLoggedIn";
const LEGACY_SESSION_KEY_MANAGEMENT = "cpa-management-key";
const LEGACY_OBF_PREFIX = "enc::v1::";
const LEGACY_OBF_SEED = "cli-proxy-api-webui::secure-storage";

/**
 * Obfuscate the remembered management key at rest. This is deliberately NOT
 * encryption — the browser must be able to recover it — it only avoids the key
 * sitting in localStorage as readable plaintext.
 */
function obfuscate(text: string): string {
  const salted = `cpa:${text}`;
  const bytes = new TextEncoder().encode(salted);
  for (let i = 0; i < bytes.length; i++) {
    const current = bytes[i] ?? 0;
    bytes[i] = current ^ (0x5a + (i % 7));
  }
  return btoa(String.fromCharCode(...bytes));
}

function deobfuscate(encoded: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
    for (let i = 0; i < bytes.length; i++) {
      const current = bytes[i] ?? 0;
      bytes[i] = current ^ (0x5a + (i % 7));
    }
    const salted = new TextDecoder().decode(bytes);
    return salted.startsWith("cpa:") ? salted.slice(4) : null;
  } catch {
    return null;
  }
}

function getLegacyMask(isV2 = false): Uint8Array {
  try {
    const host = typeof window !== "undefined" ? window.location.host : "";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const seed = isV2
      ? `${LEGACY_OBF_SEED}|v2|${host}`
      : `${LEGACY_OBF_SEED}|${host}|${ua}`;
    return new TextEncoder().encode(seed);
  } catch {
    return new TextEncoder().encode(LEGACY_OBF_SEED);
  }
}

/**
 * Obfuscate in the legacy CPA management center format:
 *   "enc::v1::" + Base64( UTF8(JSON) XOR ("cli-proxy-api-webui::secure-storage|" + host + "|" + ua) )
 */
function obfuscateLegacy(jsonStr: string): string {
  try {
    const mask = getLegacyMask(false);
    const textBytes = new TextEncoder().encode(jsonStr);
    const xored = new Uint8Array(textBytes.length);
    for (let i = 0; i < textBytes.length; i++) {
      const byte = textBytes[i] ?? 0;
      const m = mask[i % mask.length] ?? 0;
      xored[i] = byte ^ m;
    }
    let binary = "";
    for (let i = 0; i < xored.length; i++) {
      binary += String.fromCharCode(xored[i] ?? 0);
    }
    return `${LEGACY_OBF_PREFIX}${btoa(binary)}`;
  } catch {
    return jsonStr;
  }
}

/**
 * Deobfuscate legacy CPA management center storage (supports both enc::v1:: and enc::v2::).
 */
function deobfuscateLegacy(payload: string): string {
  if (!payload) return payload;
  if (!payload.startsWith("enc::v1::") && !payload.startsWith("enc::v2::")) return payload;
  try {
    const isV2 = payload.startsWith("enc::v2::");
    const mask = getLegacyMask(isV2);
    const binary = atob(payload.slice(9));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const xored = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i] ?? 0;
      const m = mask[i % mask.length] ?? 0;
      xored[i] = byte ^ m;
    }
    return new TextDecoder().decode(xored);
  } catch {
    return payload;
  }
}

/**
 * Sync legacy credentials to localStorage and sessionStorage so that same-origin
 * embedded plugins (e.g. freetier2api, workbuddy, clinepassbridge, qoderwork, cpa-codex-candy-eval)
 * can automatically resolve the management key.
 */
function syncLegacyAuth(key: string, remember: boolean) {
  try {
    if (typeof window === "undefined") return;

    if (key && remember) {
      const origin = window.location.origin;
      const legacyPayload = JSON.stringify({
        state: {
          apiBase: origin,
          managementKey: key,
          rememberPassword: true,
        },
        version: 0,
      });
      localStorage.setItem(LEGACY_STORAGE_KEY_AUTH, obfuscateLegacy(legacyPayload));
      localStorage.setItem(LEGACY_STORAGE_KEY_LOGGED_IN, "true");
      sessionStorage.setItem(LEGACY_SESSION_KEY_MANAGEMENT, key);
    } else if (key) {
      localStorage.removeItem(LEGACY_STORAGE_KEY_AUTH);
      localStorage.removeItem(LEGACY_STORAGE_KEY_LOGGED_IN);
      sessionStorage.setItem(LEGACY_SESSION_KEY_MANAGEMENT, key);
    } else {
      localStorage.removeItem(LEGACY_STORAGE_KEY_AUTH);
      localStorage.removeItem(LEGACY_STORAGE_KEY_LOGGED_IN);
      sessionStorage.removeItem(LEGACY_SESSION_KEY_MANAGEMENT);
    }
  } catch {
    // Ignore storage errors (e.g. private browsing restrictions)
  }
}

interface AuthState {
  key: string;
  remember: boolean;
  setKey: (key: string, remember: boolean) => void;
  clear: () => void;
}

function loadPersisted(): { key: string; remember: boolean } {
  try {
    // 1. Try modern storage key
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { key?: string };
      const key = parsed.key ? (deobfuscate(parsed.key) ?? "") : "";
      if (key) {
        syncLegacyAuth(key, true);
        return { key, remember: true };
      }
    }

    // 2. Fallback: try legacy CPA management center storage
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY_AUTH);
    if (legacyRaw) {
      const decoded = deobfuscateLegacy(legacyRaw);
      const parsed = JSON.parse(decoded) as {
        state?: { managementKey?: string; rememberPassword?: boolean };
        managementKey?: string;
      };
      const legacyKey = (parsed.state?.managementKey || parsed.managementKey || "").trim();
      const legacyRemember =
        parsed.state?.rememberPassword ??
        (localStorage.getItem(LEGACY_STORAGE_KEY_LOGGED_IN) === "true");

      if (legacyKey && legacyRemember) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: obfuscate(legacyKey) }));
        syncLegacyAuth(legacyKey, true);
        return { key: legacyKey, remember: true };
      }
    }

    return { key: "", remember: false };
  } catch {
    return { key: "", remember: false };
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  ...loadPersisted(),
  setKey: (key, remember) => {
    if (remember && key) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: obfuscate(key) }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    syncLegacyAuth(key, remember);
    set({ key, remember });
  },
  clear: () => {
    localStorage.removeItem(STORAGE_KEY);
    syncLegacyAuth("", false);
    set({ key: "", remember: false });
  },
}));

export function currentKey(): string {
  return useAuthStore.getState().key;
}
