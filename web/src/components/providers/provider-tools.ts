// Shared metadata and upstream probing helpers for the providers page.
import { config } from "@/api/management";
import { errMessage } from "@/api/types";

export type Entry = Record<string, unknown>;

export type AuthScheme = "bearer" | "x-api-key" | "x-goog-api-key";

export interface KindMeta {
  id: string;
  /** i18n key under providers.kind. */
  labelKey: string;
  path: string;
  responseKey: string;
  /** For per-key lists: the field carrying the credential; unset for openai-compatibility. */
  identity?: string;
  /** Base URL used for probing when an entry leaves base-url empty. */
  defaultBase: string;
  /** Credential scheme understood by the upstream models endpoint. */
  auth: AuthScheme;
  /** Path appended to base-url to list models. */
  modelsPath: string;
}

/** The OpenAI-compatible provider list (rich editor with per-key entries). */
export const COMPAT_KIND: KindMeta = {
  id: "openai-compatibility",
  labelKey: "openaiCompat",
  path: "openai-compatibility",
  responseKey: "openai-compatibility",
  defaultBase: "",
  auth: "bearer",
  modelsPath: "models",
};

/** Typed single-credential provider lists. */
export const KEY_KINDS: KindMeta[] = [
  { id: "gemini", labelKey: "gemini", path: "gemini-api-key", responseKey: "gemini-api-key", identity: "api-key", defaultBase: "https://generativelanguage.googleapis.com", auth: "x-goog-api-key", modelsPath: "v1beta/models" },
  { id: "claude", labelKey: "claude", path: "claude-api-key", responseKey: "claude-api-key", identity: "api-key", defaultBase: "https://api.anthropic.com", auth: "x-api-key", modelsPath: "v1/models" },
  { id: "codex", labelKey: "codex", path: "codex-api-key", responseKey: "codex-api-key", identity: "api-key", defaultBase: "https://chatgpt.com/backend-api/codex", auth: "bearer", modelsPath: "models" },
  { id: "xai", labelKey: "xai", path: "xai-api-key", responseKey: "xai-api-key", identity: "api-key", defaultBase: "https://api.x.ai/v1", auth: "bearer", modelsPath: "models" },
  { id: "meta", labelKey: "meta", path: "meta-api-key", responseKey: "meta-api-key", identity: "api-key", defaultBase: "", auth: "bearer", modelsPath: "models" },
  { id: "vertex", labelKey: "vertex", path: "vertex-api-key", responseKey: "vertex-api-key", identity: "api-key", defaultBase: "https://aiplatform.googleapis.com", auth: "x-goog-api-key", modelsPath: "v1/publishers/google/models" },
  { id: "interactions", labelKey: "interactions", path: "interactions-api-key", responseKey: "interactions-api-key", identity: "api-key", defaultBase: "https://generativelanguage.googleapis.com", auth: "x-goog-api-key", modelsPath: "v1beta/models" },
];

export const ALL_KINDS: KindMeta[] = [COMPAT_KIND, ...KEY_KINDS];

// ------------------------------------------------------------- upstream probes

export interface ProbeResult {
  ok: boolean;
  code?: number;
  message?: string;
}

/** Everything needed to talk to an upstream models endpoint directly. */
export interface UpstreamTarget {
  baseURL: string;
  apiKey: string;
  auth: AuthScheme;
  modelsPath: string;
  proxyURL?: string;
}

/** Build an UpstreamTarget from kind metadata + entry values. */
export function targetFor(kind: Pick<KindMeta, "auth" | "modelsPath" | "defaultBase">, baseURL: string, apiKey: string, proxyURL?: string): UpstreamTarget {
  return { baseURL: baseURL || kind.defaultBase, apiKey, auth: kind.auth, modelsPath: kind.modelsPath, proxyURL };
}

function joinURL(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Auth headers for a credential scheme. */
export function authHeaders(auth: AuthScheme, apiKey: string): Record<string, string> {
  if (auth === "x-api-key") return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  if (auth === "x-goog-api-key") return { "x-goog-api-key": apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}

/** Resolve the models-list URL for a target. Vertex resource-prefixed base
 *  URLs (containing /publishers/) are already full endpoints. */
export function modelsURL(target: UpstreamTarget): string {
  if (target.auth === "x-goog-api-key" && target.baseURL.includes("/publishers/")) return target.baseURL;
  return joinURL(target.baseURL, target.modelsPath);
}

/** Probe an upstream with GET <models endpoint> using the given credential. */
export async function probeUpstream(target: UpstreamTarget): Promise<ProbeResult> {
  if (!target.baseURL || !target.apiKey) return { ok: false, message: "missing" };
  try {
    const result = await config.apiCall({
      method: "GET",
      url: modelsURL(target),
      header: authHeaders(target.auth, target.apiKey),
      ...(target.proxyURL ? { proxy_url: target.proxyURL } : {}),
    });
    const ok = result.status_code >= 200 && result.status_code < 300;
    return { ok, code: result.status_code, message: ok ? undefined : result.body.slice(0, 200) };
  } catch (error) {
    return { ok: false, message: errMessage(error) };
  }
}

/** POST /chat/completions against the upstream with a concrete model. */
export async function probeChatCompletion(target: UpstreamTarget, model: string): Promise<ProbeResult> {
  if (!target.baseURL || !target.apiKey) return { ok: false, message: "missing" };
  const url = joinURL(target.baseURL, "chat/completions");
  try {
    const result = await config.apiCall({
      method: "POST",
      url,
      header: { Authorization: `Bearer ${target.apiKey}`, "Content-Type": "application/json" },
      data: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
      ...(target.proxyURL ? { proxy_url: target.proxyURL } : {}),
    });
    const ok = result.status_code >= 200 && result.status_code < 300;
    return { ok, code: result.status_code, message: ok ? undefined : result.body.slice(0, 200) };
  } catch (error) {
    return { ok: false, message: errMessage(error) };
  }
}

/** Fetch and normalize the upstream model catalog. Understands the OpenAI
 *  ({data:[{id}]}), Gemini/Anthropic ({models|data} lists) and Ollama shapes. */
export async function fetchUpstreamModels(target: UpstreamTarget): Promise<string[]> {
  const result = await config.apiCall({
    method: "GET",
    url: modelsURL(target),
    header: authHeaders(target.auth, target.apiKey),
    ...(target.proxyURL ? { proxy_url: target.proxyURL } : {}),
  });
  if (result.status_code < 200 || result.status_code >= 300) {
    throw new Error(`${result.status_code}: ${result.body.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error("response is not JSON");
  }
  return extractModelNames(parsed);
}

function extractModelNames(parsed: unknown): string[] {
  const names: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) names.push(value.trim());
  };
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") push((item as Entry)["id"] ?? (item as Entry)["name"]);
    }
    return dedupe(names);
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Entry;
    const list = ((record.data ?? record.models) as unknown[] | undefined) ?? [];
    for (const item of list) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") {
        const name = (item as Entry)["id"] ?? (item as Entry)["name"] ?? (item as Entry).model;
        if (typeof name === "string") push(name.replace(/^models\//, ""));
      }
    }
  }
  return dedupe(names);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
