import { create } from "zustand";

const STORAGE_KEY = "cpa-dashboard-auth";

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

interface AuthState {
  key: string;
  remember: boolean;
  setKey: (key: string, remember: boolean) => void;
  clear: () => void;
}

function loadPersisted(): { key: string; remember: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { key: "", remember: false };
    const parsed = JSON.parse(raw) as { key?: string };
    const key = parsed.key ? (deobfuscate(parsed.key) ?? "") : "";
    return { key, remember: Boolean(parsed.key && key) };
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
    set({ key, remember });
  },
  clear: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ key: "", remember: false });
  },
}));

export function currentKey(): string {
  return useAuthStore.getState().key;
}
