import { useQuery } from "@tanstack/react-query";
import { requestDB, type RecordFilter } from "@/api/management";
import type { BreakdownDimension } from "@/api/types";
import { resolveRange, type TimeRange } from "@/stores/prefs";

export interface AnalyticsData {
  filter: RecordFilter;
  stats: ReturnType<typeof useQuery>["data"];
  timeseries: ReturnType<typeof useQuery>["data"];
}

/** Shared query hooks behind the dashboard and any filtered analytics view. */
export function useStatsQuery(range: TimeRange, extra: RecordFilter, refreshMs = 0) {
  const filter = withBounds(range, extra);
  return useQuery({
    queryKey: ["rdb", "stats", filter],
    queryFn: () => requestDB.stats(filter),
    refetchInterval: refreshMs || false,
    placeholderData: (previous) => previous,
  });
}

export function useTimeseriesQuery(range: TimeRange, extra: RecordFilter, refreshMs = 0) {
  const filter = withBounds(range, extra);
  return useQuery({
    queryKey: ["rdb", "timeseries", filter],
    queryFn: () => requestDB.timeseries(filter),
    refetchInterval: refreshMs || false,
    placeholderData: (previous) => previous,
  });
}

export function useBreakdownQuery(dimension: BreakdownDimension, range: TimeRange, extra: RecordFilter, refreshMs = 0, limit = 10) {
  const filter = withBounds(range, extra);
  return useQuery({
    queryKey: ["rdb", "breakdown", dimension, filter, limit],
    queryFn: () => requestDB.breakdown(dimension, filter, limit),
    refetchInterval: refreshMs || false,
    placeholderData: (previous) => previous,
  });
}

function withBounds(range: TimeRange, extra: RecordFilter): RecordFilter {
  const { from, to } = resolveRange(range);
  return { ...extra, from, to };
}

/** Humanize a backend interval for chart subtitles ("5m", "1h"...). */
export function intervalLabel(intervalMS: number | undefined): string {
  if (!intervalMS) return "";
  if (intervalMS % 86_400_000 === 0) return `${intervalMS / 86_400_000}d`;
  if (intervalMS % 3_600_000 === 0) return `${intervalMS / 3_600_000}h`;
  if (intervalMS % 60_000 === 0) return `${intervalMS / 60_000}m`;
  return `${Math.round(intervalMS / 1000)}s`;
}
