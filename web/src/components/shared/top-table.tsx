import { useTranslation } from "react-i18next";
import { formatDuration, formatInt, formatNumber, formatPercent, formatTPS } from "@/lib/format";
import type { BreakdownRow } from "@/api/types";

interface TopTableProps {
  rows: BreakdownRow[] | undefined;
  loading: boolean;
  emptyLabel: string;
  /** Render the row key (e.g. masked API key or mono model name). */
  renderKey?: (key: string) => React.ReactNode;
  maxRows?: number;
}

/** Ranked group-by table with a relative-volume bar. */
export function TopTable({ rows, loading, emptyLabel, renderKey, maxRows = 10 }: TopTableProps) {
  const { t } = useTranslation();
  if (loading && !rows) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{t("common.loading")}</p>;
  }
  if (!rows || rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{emptyLabel}</p>;
  }
  const shown = rows.slice(0, maxRows);
  const maxRequests = Math.max(...shown.map((row) => row.requests), 1);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground border-b text-left text-xs">
          <th className="pb-2 font-medium">{t("dashboard.table.key")}</th>
          <th className="pb-2 text-right font-medium">{t("dashboard.table.requests")}</th>
          <th className="pb-2 text-right font-medium">{t("dashboard.table.errorRate")}</th>
          <th className="pb-2 text-right font-medium">{t("dashboard.table.tokens")}</th>
          <th className="pb-2 text-right font-medium">{t("dashboard.table.avgLatency")}</th>
          <th className="pb-2 text-right font-medium">{t("dashboard.table.tps")}</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => {
          const errorRate = row.requests > 0 ? row.failed / row.requests : 0;
          return (
            <tr key={row.key} className="border-border/60 border-b last:border-0">
              <td className="max-w-0 py-2 pr-3">
                <div className="flex items-center gap-2">
                  <div className="bg-primary/15 h-1.5 w-12 shrink-0 overflow-hidden rounded-full">
                    <div className="bg-primary h-full rounded-full" style={{ width: `${(row.requests / maxRequests) * 100}%` }} />
                  </div>
                  <span className="truncate font-mono text-xs" title={row.key}>
                    {renderKey ? renderKey(row.key) : row.key}
                  </span>
                </div>
              </td>
              <td className="py-2 text-right tabular-nums">{formatInt(row.requests)}</td>
              <td className={`py-2 text-right tabular-nums ${errorRate > 0.05 ? "text-rose-500" : "text-muted-foreground"}`}>
                {formatPercent(errorRate)}
              </td>
              <td className="py-2 text-right tabular-nums">{formatNumber(row.total_tokens)}</td>
              <td className="py-2 text-right tabular-nums">{formatDuration(row.latency_avg_ms)}</td>
              <td className="py-2 text-right tabular-nums">{formatTPS(row.tps_avg)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
