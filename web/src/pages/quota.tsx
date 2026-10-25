import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Coins, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { JsonView, SectionCard } from "@/components/shared/misc";
import { credentials, quota } from "@/api/management";
import { errMessage, type AuthFileEntry } from "@/api/types";

interface QuotaResult {
  entry: AuthFileEntry;
  data?: unknown;
  error?: string;
}

export function QuotaPage() {
  const { t } = useTranslation();
  const files = useQuery({ queryKey: ["auth-files"], queryFn: () => credentials.list(), refetchInterval: 30_000 });
  const providers = useQuery({ queryKey: ["quota-providers"], queryFn: quota.providers, staleTime: 60_000 });

  const quotaEntries = useMemo(() => (files.data?.files ?? []).filter((entry) => entry.supports_quota), [files.data]);
  const [results, setResults] = useState<Record<string, QuotaResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

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
    for (const entry of quotaEntries) {
      await loadOne(entry);
    }
  };

  return (
    <>
      <PageHeader title={t("nav.quota")} subtitle={t("quota.subtitle")}>
        <Button size="sm" className="h-8 text-xs" onClick={loadAll} disabled={quotaEntries.length === 0}>
          <RefreshCw className="size-3.5" />
          {t("quota.loadAll")}
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
                      className="h-7 text-xs text-amber-600"
                      onClick={async () => {
                        try {
                          await quota.resetRouting(key);
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
 * Plugin quota payloads vary per provider; render known simple shapes as a
 * definition grid and fall back to formatted JSON.
 */
function QuotaPayload({ data }: { data: unknown }) {
  if (data === null || data === undefined) return <JsonView value={data} />;
  if (typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
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
