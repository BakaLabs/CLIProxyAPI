import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Gauge, Loader2, RefreshCw, ShieldAlert, Sparkles, Vibrate } from "lucide-react";
import { Mascot } from "@/components/shared/mascot";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard, SampledBadge } from "@/components/shared/misc";
import { TopTable } from "@/components/shared/top-table";
import { TimeRangeSelect } from "@/components/shared/time-range-select";
import { RequestDBDisabled } from "@/components/shared/misc";
import { intervalLabel, useBreakdownQuery, useStatsQuery, useTimeseriesQuery } from "@/hooks/use-analytics";
import { dayjs, downloadText, formatDuration, formatInt, formatNumber, formatPercent, formatTPS, maskKey, toCSV } from "@/lib/format";
import { errStatus } from "@/api/types";
import { usePrefsStore, type TimeRange } from "@/stores/prefs";

const chartConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
  failed: { label: "Failed", color: "var(--chart-5)" },
  input_tokens: { label: "Input", color: "var(--chart-2)" },
  output_tokens: { label: "Output", color: "var(--chart-1)" },
  tps: { label: "TPS", color: "var(--chart-6)" },
  ttft: { label: "TTFT", color: "var(--chart-4)" },
  latency: { label: "Avg", color: "var(--chart-3)" },
  count: { label: "Requests", color: "var(--chart-6)" },
} satisfies ChartConfig;

export function DashboardPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<TimeRange>({ preset: usePrefsStore.getState().defaultRange });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshMs = autoRefresh ? 30_000 : 0;

  const stats = useStatsQuery(range, {}, refreshMs);
  const timeseries = useTimeseriesQuery(range, {}, refreshMs);
  const models = useBreakdownQuery("model", range, {}, refreshMs, 8);
  const providers = useBreakdownQuery("provider", range, {}, refreshMs, 8);
  const keys = useBreakdownQuery("api_key", range, {}, refreshMs, 8);
  const sessions = useBreakdownQuery("session_id", range, {}, refreshMs, 8);

  if (stats.error && errStatus(stats.error) === 503) {
    return (
      <>
        <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")} />
        <RequestDBDisabled />
      </>
    );
  }

  const points = timeseries.data?.points ?? [];
  const step = timeseries.data?.interval_ms ?? 0;
  const stepLabel = intervalLabel(step);
  const timeRange = range.preset === "custom" || (timeseries.data && timeseries.data.to_ms - timeseries.data.from_ms > 4 * 86_400_000);
  const xTick = (value: number) => dayjs(value).format(timeRange ? "MM-DD" : "HH:mm");

  const errorRate = stats.data && stats.data.total_requests > 0 ? stats.data.failed_requests / stats.data.total_requests : null;
  const ttftPoints = useMemo(() => points.filter((p) => p.ttft_avg_ms > 0), [points]);
  const updated = timeseries.isFetching ? null : <span suppressHydrationWarning>{t("dashboard.refreshedAt", { time: dayjs().format("HH:mm:ss") })}</span>;

  return (
    <>
      <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")}>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          {t("common.autoRefresh")}
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
        </label>
        <TimeRangeSelect value={range} onChange={setRange} />
        <Button variant="outline" size="icon" className="size-8 rounded-xl" onClick={() => { stats.refetch(); timeseries.refetch(); }}>
          {stats.isFetching ? <Loader2 className="size-4 animate-spin text-blue-500" /> : <RefreshCw className="size-4" />}
        </Button>
      </PageHeader>

      {/* Hero Welcome Banner */}
      <div className="mb-6 relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 p-6 text-white shadow-sm">
        <div className="absolute right-8 -bottom-4 opacity-90 hidden sm:block">
          <Mascot size={115} mood="happy" />
        </div>
        <div className="relative z-10 max-w-xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md mb-2">
            <Sparkles className="size-3 text-amber-300" />
            <span>{t("dashboard.heroBadge")}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight">
            {t("dashboard.heroTitle")}
          </h2>
          <p className="mt-1 text-xs text-blue-100/90 leading-relaxed">
            {t("dashboard.heroDesc")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label={t("dashboard.kpi.requests")}
          value={formatInt(stats.data?.total_requests)}
          sub={
            <>
              <Vibrate className="mr-1 inline size-3" />
              {formatInt(stats.data?.stream_requests)} stream
            </>
          }
          icon={ArrowUpRight}
          loading={stats.isLoading}
        />
        <StatCard
          label={t("dashboard.kpi.errorRate")}
          value={formatPercent(errorRate)}
          sub={
            <span className="text-rose-500">
              {formatInt(stats.data?.failed_requests)} {t("common.failure").toLowerCase()}
            </span>
          }
          icon={ShieldAlert}
          loading={stats.isLoading}
        />
        <StatCard
          label={t("dashboard.kpi.tokens")}
          value={formatNumber(stats.data?.total_tokens)}
          sub={
            <>
              <ArrowDownRight className="mr-0.5 inline size-3 text-sky-500" />
              {formatNumber(stats.data?.input_tokens)}
              <ArrowUpRight className="mr-0.5 ml-2 inline size-3 text-emerald-500" />
              {formatNumber(stats.data?.output_tokens)}
            </>
          }
          icon={ArrowUpRight}
          loading={stats.isLoading}
        />
        <StatCard
          label={t("dashboard.kpi.tps")}
          value={formatTPS(stats.data?.tps_avg)}
          sub={
            <>
              p50 {formatTPS(stats.data?.tps_p50)} · p90 {formatTPS(stats.data?.tps_p90)}
              <SampledBadge sampled={Boolean(stats.data?.tps_sampled)} />
            </>
          }
          icon={Gauge}
          loading={stats.isLoading}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <SectionCard
          title={t("dashboard.charts.traffic")}
          hint={t("dashboard.charts.trafficHint", { interval: stepLabel })}
          className="xl:col-span-2"
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={points.length === 0}
              onClick={() => downloadText(`cpa-traffic-${range.preset}.csv`, exportTimeseries(points))}
            >
              {t("common.export")}
            </Button>
          }
        >
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <AreaChart data={points} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={48} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={38} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value, name) => <span className="font-mono">{formatInt(Number(value))} {chartConfig[name as keyof typeof chartConfig]?.label ?? name}</span>}
                  />
                }
              />
              <Area dataKey="failed" stroke="var(--color-failed)" fill="var(--color-failed)" fillOpacity={0.25} strokeWidth={1.5} />
              <Area dataKey="requests" stroke="var(--color-requests)" fill="var(--color-requests)" fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </SectionCard>

        <SectionCard title={t("dashboard.charts.tpsHistogram")}>
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <BarChart data={stats.data?.tps_histogram ?? []} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} angle={-30} height={40} textAnchor="end" />
              <YAxis tickLine={false} axisLine={false} width={34} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v)} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="font-mono">{formatInt(Number(value))}</span>} />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </SectionCard>

        <SectionCard title={t("dashboard.charts.tokens")} hint={t("dashboard.charts.tokensHint", { interval: stepLabel })}>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <AreaChart data={points} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={38} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value, name) => <span className="font-mono">{formatNumber(Number(value))} {chartConfig[name as keyof typeof chartConfig]?.label ?? name}</span>}
                  />
                }
              />
              <Area dataKey="input_tokens" stackId="tokens" stroke="var(--color-input_tokens)" fill="var(--color-input_tokens)" fillOpacity={0.3} strokeWidth={1.5} />
              <Area dataKey="output_tokens" stackId="tokens" stroke="var(--color-output_tokens)" fill="var(--color-output_tokens)" fillOpacity={0.3} strokeWidth={1.5} />
            </AreaChart>
          </ChartContainer>
        </SectionCard>

        <SectionCard title={t("dashboard.charts.latency")} hint={t("dashboard.charts.latencyHint")}>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <LineChart data={points} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatDuration(v)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value) => <span className="font-mono">{formatDuration(Number(value))}</span>}
                  />
                }
              />
              {stats.data && stats.data.latency_p50_ms > 0 && (
                <ReferenceLine y={stats.data.latency_p50_ms} stroke="var(--color-latency)" strokeDasharray="4 4" strokeOpacity={0.7} />
              )}
              {stats.data && stats.data.latency_p99_ms > 0 && (
                <ReferenceLine y={stats.data.latency_p99_ms} stroke="var(--color-failed)" strokeDasharray="4 4" strokeOpacity={0.7} />
              )}
              <Line dataKey="latency_avg_ms" stroke="var(--color-latency)" strokeWidth={2} dot={false} name="avg" />
            </LineChart>
          </ChartContainer>
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 text-xs">
            <span>p50 {formatDuration(stats.data?.latency_p50_ms)}</span>
            <span>p90 {formatDuration(stats.data?.latency_p90_ms)}</span>
            <span>p99 {formatDuration(stats.data?.latency_p99_ms)}</span>
            <SampledBadge sampled={Boolean(stats.data?.latency_sampled)} />
          </div>
        </SectionCard>

        <SectionCard title={t("dashboard.charts.tps")} hint={t("dashboard.charts.tpsHint", { interval: stepLabel })}>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <LineChart data={points} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatTPS(v).replace(" t/s", "")} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value) => <span className="font-mono">{formatTPS(Number(value))}</span>}
                  />
                }
              />
              <Line dataKey="tps_avg" stroke="var(--color-tps)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </SectionCard>

        <SectionCard title={t("dashboard.charts.ttft")} hint={t("dashboard.charts.ttftHint")}>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <AreaChart data={ttftPoints} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="bucket_ms" tickFormatter={xTick} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatDuration(v)} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => dayjs(Number(label)).format("MM-DD HH:mm")}
                    formatter={(value) => <span className="font-mono">{formatDuration(Number(value))}</span>}
                  />
                }
              />
              <Area dataKey="ttft_avg_ms" stroke="var(--color-ttft)" fill="var(--color-ttft)" fillOpacity={0.2} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 text-xs">
            <span>p50 {formatDuration(stats.data?.ttft_p50_ms)}</span>
            <span>p90 {formatDuration(stats.data?.ttft_p90_ms)}</span>
            <SampledBadge sampled={Boolean(stats.data?.ttft_sampled)} />
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title={t("dashboard.charts.models")} hint={`${formatInt(stats.data?.unique_models)} ${t("dashboard.kpi.models").toLowerCase()}`}>
          <TopTable rows={models.data} loading={models.isLoading} emptyLabel={t("dashboard.charts.empty")} />
        </SectionCard>
        <SectionCard title={t("dashboard.charts.providers")} hint={`${formatInt(stats.data?.unique_providers)} ${t("dashboard.kpi.providers").toLowerCase()}`}>
          <TopTable rows={providers.data} loading={providers.isLoading} emptyLabel={t("dashboard.charts.empty")} />
        </SectionCard>
        <SectionCard title={t("dashboard.charts.keys")} hint={`${formatInt(stats.data?.unique_api_keys)} ${t("dashboard.kpi.keys").toLowerCase()}`}>
          <TopTable
            rows={keys.data}
            loading={keys.isLoading}
            emptyLabel={t("dashboard.charts.empty")}
            renderKey={(key) => maskKey(key)}
          />
        </SectionCard>
        <SectionCard title={t("dashboard.charts.sessions")} hint={`${formatInt(stats.data?.unique_sessions)} ${t("dashboard.kpi.sessions").toLowerCase()}`}>
          <TopTable rows={sessions.data} loading={sessions.isLoading} emptyLabel={t("dashboard.charts.empty")} />
        </SectionCard>
      </div>

      {updated ? <p className="text-muted-foreground mt-4 text-center text-xs">{updated}</p> : null}
    </>
  );
}

function exportTimeseries(points: { bucket_ms: number; requests: number; failed: number; input_tokens: number; output_tokens: number; total_tokens: number; latency_avg_ms: number; tps_avg: number }[]) {
  return toCSV(
    ["time", "requests", "failed", "input_tokens", "output_tokens", "total_tokens", "latency_avg_ms", "tps_avg"],
    points.map((p) => [
      dayjs(p.bucket_ms).format("YYYY-MM-DD HH:mm:ss"),
      p.requests,
      p.failed,
      p.input_tokens,
      p.output_tokens,
      p.total_tokens,
      p.latency_avg_ms.toFixed(1),
      p.tps_avg.toFixed(2),
    ]),
  );
}
