import { client, v0 } from "./client";
import type {
  AuthFileListResponse,
  BreakdownDimension,
  BreakdownRow,
  ErrorLogFile,
  LogLinesResponse,
  ModelInfo,
  OAuthPollStatus,
  OAuthStartResponse,
  PluginInfo,
  PluginStoreItem,
  QuotaProviderInfo,
  RequestDBStats,
  RequestRecord,
  RequestRecordPage,
  ServerInfo,
  TimeseriesResponse,
} from "./types";

// ---------------------------------------------------------------- request-db

export interface RecordFilter {
  model?: string;
  provider?: string;
  api_key?: string;
  session_id?: string;
  request_id?: string;
  trace_id?: string;
  failed?: boolean;
  status_code?: number;
  from?: number;
  to?: number;
  before_id?: number;
  page?: number;
  page_size?: number;
}

function filterParams(filter: RecordFilter): Record<string, string> {
  const params: Record<string, string> = {};
  if (filter.model) params.model = filter.model;
  if (filter.provider) params.provider = filter.provider;
  if (filter.api_key) params.api_key = filter.api_key;
  if (filter.session_id) params.session_id = filter.session_id;
  if (filter.request_id) params.request_id = filter.request_id;
  if (filter.trace_id) params.trace_id = filter.trace_id;
  if (filter.failed !== undefined) params.failed = String(filter.failed);
  if (filter.status_code) params.status_code = String(filter.status_code);
  if (filter.from) params.from = String(filter.from);
  if (filter.to) params.to = String(filter.to);
  if (filter.page) params.page = String(filter.page);
  if (filter.page_size) params.page_size = String(filter.page_size);
  return params;
}

export const requestDB = {
  async records(filter: RecordFilter): Promise<RequestRecordPage> {
    const { data } = await client.get("/observability/request-db/records", { params: filterParams(filter) });
    return data as RequestRecordPage;
  },
  async recordDetail(id: number): Promise<RequestRecord> {
    const { data } = await client.get(`/observability/request-db/records/${id}`);
    return data as RequestRecord;
  },
  async stats(filter: RecordFilter): Promise<RequestDBStats> {
    const { data } = await client.get("/observability/request-db/stats", { params: filterParams(filter) });
    return data as RequestDBStats;
  },
  async timeseries(filter: RecordFilter, intervalSeconds?: number): Promise<TimeseriesResponse> {
    const params = filterParams(filter);
    if (intervalSeconds) params.interval = String(intervalSeconds);
    const { data } = await client.get("/observability/request-db/timeseries", { params });
    return data as TimeseriesResponse;
  },
  async breakdown(dimension: BreakdownDimension, filter: RecordFilter, limit = 10): Promise<BreakdownRow[]> {
    const params = filterParams(filter);
    params.dimension = dimension;
    params.limit = String(limit);
    const { data } = await client.get("/observability/request-db/breakdown", { params });
    return (data as { rows: BreakdownRow[] }).rows;
  },
  streamPath(filter: RecordFilter): string {
    const params = new URLSearchParams();
    const mapped = filterParams(filter);
    for (const [key, value] of Object.entries(mapped)) {
      if (["page", "page_size", "before_id"].includes(key)) continue;
      params.set(key, value);
    }
    const query = params.toString();
    return `/observability/request-db/stream${query ? `?${query}` : ""}`;
  },
};

// --------------------------------------------------------------- server info

export const server = {
  async info(): Promise<ServerInfo> {
    const { data } = await client.get("/server/info");
    return data as ServerInfo;
  },
  async latestVersion(): Promise<string> {
    const { data } = await client.get("/server/latest-version");
    return (data as { "latest-version": string })["latest-version"];
  },
};

// ------------------------------------------------------------------- config

export interface ConfigGetResponse<T = Record<string, unknown>> {
  config: T;
  etag: string;
}

export const config = {
  /** GET /config returns the v8 document itself plus a strong ETag. */
  async get<T = Record<string, unknown>>(): Promise<ConfigGetResponse<T>> {
    const { data, headers } = await client.get("/config");
    return { config: data as T, etag: (headers.etag as string) ?? "" };
  },
  /** PATCH /config/<path> merges the body object into the value at path. */
  async patchPath(path: string, body: unknown, etag: string): Promise<void> {
    await client.patch(`/config/${path}`, body, { headers: { "If-Match": etag } });
  },
  async getYAML(): Promise<{ yaml: string; etag: string }> {
    const { data, headers } = await client.get("/config.yaml", { responseType: "text", transformResponse: (r) => r });
    return { yaml: data as string, etag: (headers.etag as string) ?? "" };
  },
  async putYAML(yaml: string, etag: string): Promise<void> {
    await client.put("/config.yaml", yaml, {
      headers: { "If-Match": etag, "Content-Type": "application/yaml" },
      transformRequest: [(value) => value],
    });
  },
  /** Generic credentialed upstream HTTP tool (connectivity tests, model discovery). */
  async apiCall(body: Record<string, unknown>): Promise<{ status_code: number; header: Record<string, string>; body: string }> {
    const { data } = await client.post("/requests/api-call", body);
    return data as { status_code: number; header: Record<string, string>; body: string };
  },
};

// --------------------------------------------------------------- credentials

export const credentials = {
  async list(params?: { page?: number; page_size?: number }): Promise<AuthFileListResponse> {
    const { data } = await client.get("/credentials", { params });
    return data as AuthFileListResponse;
  },
  async models(name: string): Promise<ModelInfo[]> {
    const { data } = await client.get("/credentials/models", { params: { name } });
    return (data as { models: ModelInfo[] }).models;
  },
  async upload(files: File[]): Promise<{ status?: string; uploaded?: number; failed?: { name: string; error: string }[] }> {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const { data } = await client.post("/credentials", form);
    return data as { status?: string; uploaded?: number; failed?: { name: string; error: string }[] };
  },
  async remove(names: string[], all = false): Promise<void> {
    await client.delete("/credentials", { params: all ? { all: "true" } : { name: names } });
  },
  async setStatus(name: string, disabled: boolean, authIndex?: string): Promise<void> {
    await client.patch("/credentials/status", { name, auth_index: authIndex, disabled });
  },
  async setFields(name: string, fields: Record<string, unknown>): Promise<void> {
    await client.patch("/credentials/fields", { name, ...fields });
  },
  async refresh(body: { name?: string; auth_index?: string; all?: boolean }): Promise<unknown> {
    const { data } = await client.post("/credentials/refresh", body);
    return data;
  },
  async download(name: string): Promise<void> {
    const response = await client.get("/credentials/download", { params: { name }, responseType: "blob" });
    triggerBlobDownload(response.data as Blob, name);
  },
};

// --------------------------------------------------------------------- oauth

export interface OAuthProviderSpec {
  id: string;
  /** browser flows open a URL; device flows show a code. */
  flow: "browser" | "device" | "plugin";
  domain?: string;
}

/** Built-in providers exposed by GET /oauth/auth-url?provider=. */
export const OAUTH_PROVIDERS: OAuthProviderSpec[] = [
  { id: "claude", flow: "browser" },
  { id: "codex", flow: "browser" },
  { id: "antigravity", flow: "browser" },
  { id: "devin", flow: "browser" },
  { id: "xai", flow: "device" },
  { id: "kimi", flow: "device" },
  { id: "kimi-ai", flow: "device" },
  { id: "meta", flow: "device" },
];

export const oauth = {
  async start(provider: string, opts?: { isWebUI?: boolean; domain?: string }): Promise<OAuthStartResponse> {
    const params: Record<string, string> = { provider };
    if (opts?.isWebUI) params.is_webui = "true";
    if (opts?.domain) params.domain = opts.domain;
    const { data } = await client.get("/oauth/auth-url", { params });
    return data as OAuthStartResponse;
  },
  async status(state: string): Promise<OAuthPollStatus> {
    const { data } = await client.get("/oauth/status", { params: { state } });
    return data as OAuthPollStatus;
  },
  async cancel(state: string): Promise<void> {
    await client.delete("/oauth/session", { params: { state } });
  },
  /** Submit a pasted redirect URL / code manually (remote or headless setups). */
  async callback(body: { provider?: string; redirect_url?: string; code?: string; state: string; error?: string; client_id?: string }): Promise<void> {
    await client.post("/oauth/callback", body);
  },
  async siwcBind(name: string): Promise<OAuthStartResponse> {
    const { data } = await client.post("/oauth/siwc/bind", { name });
    return data as OAuthStartResponse;
  },
  async siwcStatus(params: { name?: string; id?: string; auth_index?: string }): Promise<{ status: "off" | "valid" | "invalid" }> {
    const { data } = await client.get("/oauth/siwc/status", { params });
    return data as { status: "off" | "valid" | "invalid" };
  },
  async importVertex(file: File, location: string): Promise<{ auth_file?: string; project_id?: string; email?: string }> {
    const form = new FormData();
    form.append("file", file);
    const { data } = await client.post("/oauth/import", form, { params: { provider: "vertex", location } });
    return data as { auth_file?: string; project_id?: string; email?: string };
  },
};

// --------------------------------------------------------------------- quota

export const quota = {
  async providers(): Promise<QuotaProviderInfo[]> {
    const { data } = await client.get("/quota/providers").catch(() => ({ data: { providers: [] } }));
    return (data as { providers: QuotaProviderInfo[] }).providers;
  },
  async fetch(body: { auth_index: string; plugin_id?: string; provider?: string }): Promise<unknown> {
    const { data } = await client.post("/quota/fetch", body);
    return data;
  },
  async reset(body: { auth_index: string; plugin_id?: string; provider?: string }): Promise<unknown> {
    const { data } = await client.post("/quota/reset", body);
    return data;
  },
  async resetRouting(authIndex: string): Promise<unknown> {
    const { data } = await client.post("/routing/cooldown/reset", { auth_index: authIndex });
    return data;
  },
  async pluginQuota(pluginId: string, authIndex: string): Promise<unknown> {
    const { data } = await client.get(`/plugins/${pluginId}/quota`, { params: { auth_index: authIndex } });
    return data;
  },
};

// ------------------------------------------------------------------- plugins

export type PluginListResult = PluginInfo[] & {
  plugins_enabled?: boolean;
  plugins_dir?: string;
};

export interface PluginStoreResult {
  plugins_enabled?: boolean;
  plugins_dir?: string;
  sources_count?: number;
  plugins: PluginStoreItem[];
  sources?: unknown[];
  source_errors?: string[];
}

export const plugins = {
  async list(): Promise<PluginListResult> {
    const { data } = await client.get("/plugins");
    const payload = data as {
      plugins_enabled?: boolean;
      plugins_dir?: string;
      plugins?: PluginInfo[];
    };
    const arr = (payload.plugins ?? []) as PluginListResult;
    arr.plugins_enabled = Boolean(payload.plugins_enabled);
    arr.plugins_dir = payload.plugins_dir || "plugins";
    return arr;
  },
  async store(): Promise<PluginStoreResult> {
    const { data } = await client.get("/plugins/store");
    return data as PluginStoreResult;
  },
  async install(storeId: string, opts?: { version?: string; source?: string }): Promise<void> {
    await client.post(`/plugins/store/${storeId}/install`, null, { params: opts });
  },
  async remove(id: string): Promise<void> {
    await client.delete(`/plugins/${id}`);
  },
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await client.patch(`/plugins/${id}/enabled`, { enabled }, v0());
  },
  async getConfig(id: string): Promise<Record<string, unknown>> {
    const { data } = await client.get(`/plugins/${id}/config`, v0());
    return (data || {}) as Record<string, unknown>;
  },
  async putConfig(id: string, body: unknown): Promise<void> {
    await client.put(`/plugins/${id}/config`, body, v0());
  },
};

// ---------------------------------------------------------------- file logs

export const fileLogs = {
  async lines(params: { limit?: number; cursor?: string; after?: number }): Promise<LogLinesResponse> {
    const { data } = await client.get("/observability/logs", { params });
    return data as LogLinesResponse;
  },
  async clear(): Promise<void> {
    await client.delete("/observability/logs");
  },
  async errorLogs(): Promise<ErrorLogFile[]> {
    const { data } = await client.get("/observability/logs/errors");
    return (data as { files: ErrorLogFile[] }).files;
  },
  async downloadErrorLog(name: string): Promise<void> {
    const response = await client.get(`/observability/logs/errors/${name}`, { responseType: "blob" });
    triggerBlobDownload(response.data as Blob, name);
  },
  async downloadRequestLog(requestID: string): Promise<void> {
    const response = await client.get(`/observability/logs/requests/${requestID}`, { responseType: "blob" });
    triggerBlobDownload(response.data as Blob, `${requestID}.log`);
  },
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------- api-key provider lists

/** CRUD against the generic string-list and typed provider-list endpoints.
 *  These list endpoints live only under the legacy v0 prefix. */
export const providerLists = {
  async getList<T>(path: string, responseKey: string): Promise<T[]> {
    const { data } = await client.get(`/${path}`, v0());
    const value = (data as Record<string, unknown>)[responseKey];
    return Array.isArray(value) ? (value as T[]) : [];
  },
  async getMap<T>(path: string, responseKey: string): Promise<T> {
    const { data } = await client.get(`/${path}`, v0());
    return ((data as Record<string, unknown>)[responseKey] ?? {}) as T;
  },
  /** Typed/string lists accept a bare array or an {"items": [...]} wrapper. */
  async putList<T>(path: string, items: T[]): Promise<void> {
    await client.put(`/${path}`, { items }, v0());
  },
  /** Map-shaped endpoints (oauth-excluded-models, oauth-model-alias) take the bare object. */
  async putMap(path: string, map: unknown): Promise<void> {
    await client.put(`/${path}`, map, v0());
  },
};
