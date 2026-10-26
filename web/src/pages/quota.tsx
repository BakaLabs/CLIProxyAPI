import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Code2, Coins, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import dayjs from "dayjs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { JsonView, SectionCard } from "@/components/shared/misc";
import { credentials, quota } from "@/api/management";
import { errMessage, type AuthFileEntry } from "@/api/types";
import { cn } from "@/lib/utils";

interface QuotaResult {
  entry: AuthFileEntry;
  data?: unknown;
  error?: string;
}

interface RawBucket {
  window?: string;
  displayName?: string;
  description?: string;
  remaining_fraction?: number;
  remaining_percent?: number;
  remainingFraction?: number;
  used_percent?: number;
  reset_time?: string | number;
  resetTime?: string | number;
}

interface RawBalanceInfo {
  currency?: string;
  total_balance?: string | number;
  granted_balance?: string | number;
  topped_up_balance?: string | number;
}

function formatQuotaResetTime(raw: string | number | undefined | null): string {
  if (!raw) return "";
  const d = typeof raw === "number" ? (raw < 1e11 ? dayjs.unix(raw) : dayjs(raw)) : dayjs(raw);
  if (!d.isValid()) return String(raw);
  return d.format("MM/DD HH:mm");
}

export function QuotaPage() {
  const { t } = useTranslation();
  const files = useQuery({ queryKey: ["auth-files"], queryFn: () => credentials.list(), refetchInterval: 30_000 });
  const providers = useQuery({ queryKey: ["quota-providers"], queryFn: quota.providers, staleTime: 60_000 });

  const quotaEntries = useMemo(() => (files.data?.files ?? []).filter((entry) => entry.supports_quota), [files.data]);
  const [results, setResults] = useState<Record<string, QuotaResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [batchLoading, setBatchLoading] = useState(false);

  const loadOne = async (entry: AuthFileEntry) => {
    const key = entry.auth_index || entry.id;
    setLoading((current) => ({ ...current, [key]: true }));
    try {
      const data = await quota.fetch({
        auth_index: String(key),
        plugin_id: typeof entry.quota_plugin_id === "string" ? entry.quota_plugin_id : undefined,
        provider: entry.quota_provider,
      });
      setResults((current) => ({ ...current, [key]: { entry, data } }));
    } catch (error) {
      setResults((current) => ({ ...current, [key]: { entry, error: errMessage(error) } }));
    } finally {
      setLoading((current) => ({ ...current, [key]: false }));
    }
  };

  const loadAll = async () => {
    if (quotaEntries.length === 0 || batchLoading) return;
    setBatchLoading(true);
    try {
      const concurrency = 4;
      const queue = [...quotaEntries];
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item) {
            await loadOne(item);
          }
        }
      });
      await Promise.all(workers);
      toast.success(t("common.saved", "全部配额查询完成"));
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <>
      <PageHeader title={t("nav.quota")} subtitle={t("quota.subtitle")}>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={loadAll}
          disabled={quotaEntries.length === 0 || batchLoading}
        >
          {batchLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {batchLoading ? "批量查询中..." : t("quota.loadAll")}
        </Button>
      </PageHeader>

      {quotaEntries.length === 0 ? (
        <div className="border-border/60 bg-card/50 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-16 text-center">
          <Coins className="text-muted-foreground size-8" />
          <p className="font-medium">{t("quota.none")}</p>
          <p className="text-muted-foreground text-sm">{t("quota.noneHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">
            {t("quota.providerCount", { count: (providers.data ?? []).length })} · {t("quota.entryCount", { count: quotaEntries.length })}
          </p>
          {quotaEntries.map((entry) => {
            const key = String(entry.auth_index || entry.id);
            const result = results[key];
            const isLoading = loading[key];
            return (
              <SectionCard
                key={key}
                title={entry.name || entry.id}
                hint={`${entry.provider ?? t("common.unknown")} · #${key}`}
                actions={
                  <>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void loadOne(entry)} disabled={isLoading}>
                      {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                      {t("quota.fetch")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-amber-600 hover:text-amber-700"
                      onClick={async () => {
                        try {
                          await quota.reset({
                            auth_index: key,
                            plugin_id: typeof entry.quota_plugin_id === "string" ? entry.quota_plugin_id : undefined,
                            provider: entry.quota_provider,
                          }).catch(() => quota.resetRouting(key));
                          toast.success(t("quota.cooldownReset"));
                        } catch (error) {
                          toast.error(errMessage(error));
                        }
                      }}
                    >
                      <RotateCcw className="size-3.5" />
                      {t("quota.resetCooldown")}
                    </Button>
                  </>
                }
              >
                {result?.error ? (
                  <p className="text-destructive text-sm">{result.error}</p>
                ) : result?.data !== undefined ? (
                  <QuotaPayload data={result.data} />
                ) : (
                  <p className="text-muted-foreground text-sm">{t("quota.notLoaded")}</p>
                )}
              </SectionCard>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Renders normalized quota buckets, plans, and balance info with progress bars,
 * falling back to simple definition grids or expandable raw JSON.
 */
function QuotaPayload({ data }: { data: unknown }) {
  const [showRaw, setShowRaw] = useState(false);
  if (data === null || data === undefined) return <JsonView value={data} />;

  if (typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const sub = typeof obj.subscription === "object" && obj.subscription !== null ? (obj.subscription as Record<string, unknown>) : null;
    const plan = (typeof obj.plan === "string" && obj.plan) || (sub && typeof sub.plan === "string" && sub.plan) || null;

    let buckets: RawBucket[] = [];
    if (Array.isArray(obj.buckets)) {
      buckets = obj.buckets as RawBucket[];
    } else if (Array.isArray(obj.groups)) {
      for (const grp of obj.groups as Array<{ buckets?: RawBucket[] }>) {
        if (Array.isArray(grp?.buckets)) {
          buckets.push(...grp.buckets);
        }
      }
    }

    const balanceInfos = Array.isArray(obj.balance_infos) ? (obj.balance_infos as RawBalanceInfo[]) : null;
    const resetCredits = obj.rate_limit_reset_credits ?? obj.credits;

    if (buckets.length > 0 || balanceInfos || plan) {
      return (
        <div className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {plan && (
                <Badge variant="secondary" className="px-2 py-0.5 text-xs font-semibold">
                  {plan}
                </Badge>
              )}
              {resetCredits !== undefined && resetCredits !== null && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  重置点数: {String(resetCredits)}
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] text-muted-foreground gap-1 px-2 hover:bg-muted"
              onClick={() => setShowRaw(!showRaw)}
            >
              <Code2 className="size-3" />
              {showRaw ? "收起原始数据" : "原始数据"}
              {showRaw ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </Button>
          </div>

          {buckets.length > 0 && (
            <div className="space-y-2.5">
              {buckets.map((b, i) => {
                const rawPct =
                  b.remaining_percent ??
                  (b.remaining_fraction !== undefined
                    ? Math.round(b.remaining_fraction * 100)
                    : b.remainingFraction !== undefined
                      ? Math.round(b.remainingFraction * 100)
                      : undefined);
                const pct = rawPct !== undefined ? Math.max(0, Math.min(100, rawPct)) : 100;
                const windowLabel = b.window || b.displayName || b.description || `限额窗口 ${i + 1}`;
                const resetTimeStr = formatQuotaResetTime(b.reset_time || b.resetTime);
                const isGreen = pct > 60;
                const isAmber = pct >= 20 && pct <= 60;
                const isRose = pct < 20;

                return (
                  <div key={i} className="space-y-1.5 rounded-lg border border-border/50 bg-muted/20 p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{windowLabel}</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span
                          className={cn(
                            "font-bold",
                            isGreen && "text-emerald-600 dark:text-emerald-400",
                            isAmber && "text-amber-500 dark:text-amber-400",
                            isRose && "text-rose-500 dark:text-rose-400"
                          )}
                        >
                          {pct}%
                        </span>
                        {resetTimeStr && <span className="text-muted-foreground text-[11px]">重置于 {resetTimeStr}</span>}
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          isGreen && "bg-emerald-500",
                          isAmber && "bg-amber-500",
                          isRose && "bg-rose-500"
                        )}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {balanceInfos && balanceInfos.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {balanceInfos.map((bal, idx) => (
                <div key={idx} className="rounded-lg border border-border/50 bg-muted/20 p-2.5 space-y-1">
                  <div className="text-[11px] text-muted-foreground">总余额 ({bal.currency || "CNY"})</div>
                  <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {String(bal.total_balance ?? "0.00")}
                  </div>
                  {bal.topped_up_balance !== undefined && (
                    <div className="text-[11px] text-muted-foreground">
                      充值: {String(bal.topped_up_balance)} · 赠送: {String(bal.granted_balance ?? "0")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showRaw && (
            <div className="pt-1">
              <JsonView value={data} />
            </div>
          )}
        </div>
      );
    }

    const entries = Object.entries(obj);
    const simple = entries.filter(([, value]) => ["string", "number", "boolean"].includes(typeof value));
    if (simple.length >= Math.max(1, entries.length - 2)) {
      return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {entries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-muted-foreground truncate text-xs">{key}</dt>
              <dd className="mt-0.5 truncate font-mono text-xs">{String(value)}</dd>
            </div>
          ))}
        </dl>
      );
    }
  }
  return <JsonView value={data} />;
}
