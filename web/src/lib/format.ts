import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

export { dayjs };

const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const fullFormatter = new Intl.NumberFormat("en");

/** 1234567 -> "1.2M"; full=false keeps separators. */
export function formatNumber(value: number | undefined | null, full = false): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return full ? fullFormatter.format(value) : compactFormatter.format(value);
}

export function formatTokens(value: number | undefined | null): string {
  return formatNumber(value);
}

/** 1234 -> "1,234" always with separators (for KPI cards). */
export function formatInt(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return fullFormatter.format(Math.round(value));
}

/** Milliseconds -> human span like "1.2s" / "350ms" / "2m 04s". */
export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Output tokens per second. */
export function formatTPS(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  if (value >= 100) return `${value.toFixed(0)} t/s`;
  if (value >= 10) return `${value.toFixed(1)} t/s`;
  return `${value.toFixed(2)} t/s`;
}

export function formatPercent(ratio: number | undefined | null, digits = 1): string {
  if (ratio === undefined || ratio === null || Number.isNaN(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Formats USD cost, e.g. "$0.00", "$0.042", "$12.50". */
export function formatUSD(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.001) return `< $0.001`;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Unix milliseconds -> local time; precise=true adds seconds. */
export function formatTime(ms: number | undefined | null, precise = false): string {
  if (!ms) return "—";
  return dayjs(ms).format(precise ? "MM-DD HH:mm:ss" : "MM-DD HH:mm");
}

export function formatFullTime(ms: number | undefined | null): string {
  if (!ms) return "—";
  return dayjs(ms).format("YYYY-MM-DD HH:mm:ss");
}

export function fromNow(ms: number | undefined | null): string {
  if (!ms) return "—";
  return dayjs(ms).fromNow();
}

/** Show only the first and last four characters of a secret-ish key. */
export function maskKey(key: string | undefined | null): string {
  if (!key) return "—";
  if (key.length <= 10) return key;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Successful request throughput: output tokens over elapsed seconds. */
export function computeTPS(outputTokens: number, latencyMs: number): number {
  if (latencyMs <= 0) return 0;
  return outputTokens / (latencyMs / 1000);
}

/** Download any text payload as a file from the browser. */
export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Escape and join rows into a CSV file body (with BOM for Excel). */
export function toCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const escape = (cell: string | number | boolean | null | undefined) => {
    const text = cell === null || cell === undefined ? "" : String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))];
  return "\uFEFF" + lines.join("\n");
}

/** Milliseconds -> seconds with unit, e.g. "2.19 s", "19.9 s", "118.5 s". */
export function formatLatencySeconds(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || Number.isNaN(ms) || ms <= 0) return "—";
  const sec = ms / 1000;
  if (sec < 10) {
    return `${parseFloat(sec.toFixed(2))} s`;
  }
  return `${parseFloat(sec.toFixed(1))} s`;
}

/** Return text color class for total duration/latency based on green-yellow-red thresholds. */
export function getLatencyColorClass(ms: number | undefined | null): string {
  if (!ms || ms <= 0) return "text-muted-foreground";
  if (ms <= 10_000) return "text-emerald-500 dark:text-emerald-400 font-mono";
  if (ms <= 30_000) return "text-amber-500 dark:text-amber-400 font-mono";
  return "text-rose-500 dark:text-rose-400 font-mono";
}

/** Return text color class for TTFT (first token) based on green-yellow-red thresholds. */
export function getTTFTColorClass(ms: number | undefined | null): string {
  if (!ms || ms <= 0) return "text-muted-foreground";
  if (ms <= 4000) return "text-emerald-500 dark:text-emerald-400 font-mono";
  if (ms <= 10_000) return "text-amber-500 dark:text-amber-400 font-mono";
  return "text-rose-500 dark:text-rose-400 font-mono";
}

/** Calculate prompt cache hit rate percentage string (e.g. "85%", "12.5%", "0%"). */
export function computeCacheHitRate(record: {
  cached_tokens?: number;
  cache_read_tokens?: number;
  input_tokens?: number;
  provider?: string;
  executor_type?: string;
}): string {
  const cached = Math.max(record.cached_tokens || 0, record.cache_read_tokens || 0);
  if (cached <= 0) return "0%";

  const isAnthropic = Boolean(
    record.provider?.toLowerCase().includes("anthropic") ||
    record.provider?.toLowerCase().includes("claude") ||
    record.executor_type?.toLowerCase().includes("claude")
  );

  const promptTokens = isAnthropic
    ? ((record.input_tokens || 0) + cached)
    : Math.max(record.input_tokens || 0, cached);

  if (promptTokens <= 0) return "0%";
  const pct = Math.min(100, Math.max(0, (cached / promptTokens) * 100));
  const rounded = Math.round(pct * 10) / 10;
  return rounded % 1 === 0 ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}
