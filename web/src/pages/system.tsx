import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Cpu, Download, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/misc";
import { StatCard } from "@/components/shared/stat-card";
import { client } from "@/api/client";
import { server } from "@/api/management";
import { errMessage } from "@/api/types";
import { useAuthStore } from "@/stores/auth";
import { formatDuration } from "@/lib/format";

const CHANNELS = ["gemini", "gemini-interactions", "claude", "codex", "antigravity", "vertex", "aistudio", "kimi", "xai", "devin", "meta"];

interface StaticModel {
  id?: string;
  display_name?: string;
}

export function SystemPage() {
  const { t } = useTranslation();
  const info = useQuery({ queryKey: ["server-info"], queryFn: server.info });
  const latest = useQuery({ queryKey: ["latest-version"], queryFn: server.latestVersion, staleTime: 300_000 });
  const [channel, setChannel] = useState("gemini");
  const models = useQuery({
    queryKey: ["model-definitions", channel],
    queryFn: async () => {
      const { data } = await client.get(`/routing/model-definitions/${channel}`);
      return (data as { models: StaticModel[] }).models;
    },
    staleTime: 300_000,
    retry: false,
  });

  const upToDate =
    latest.data && info.data?.version
      ? latest.data.replace(/^v/, "").startsWith(info.data.version.replace(/-s$/, ""))
      : null;

  return (
    <>
      <PageHeader title={t("nav.systemItem")} subtitle={t("system.subtitle")} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t("system.version")} value={info.data ? `v${info.data.version}` : "—"} sub={info.data?.commit} icon={ShieldCheck} loading={info.isLoading} />
        <StatCard label={t("system.uptime")} value={info.data ? formatDuration(info.data.uptime_seconds * 1000) : "—"} icon={Clock3} loading={info.isLoading} />
        <StatCard label={t("system.buildDate")} value={info.data?.build_date ?? "—"} icon={Cpu} loading={info.isLoading} />
        <StatCard
          label={t("system.latest")}
          value={latest.data ? `v${latest.data.replace(/^v/, "")}` : "—"}
          sub={
            upToDate === null ? undefined : upToDate ? (
              <span className="text-emerald-500">{t("system.upToDate")}</span>
            ) : (
              <span className="text-amber-500">{t("system.updateAvailable")}</span>
            )
          }
          icon={Download}
          loading={latest.isLoading}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title={t("system.runtime")}>
          <dl className="grid grid-cols-[11rem_1fr] gap-x-3 gap-y-2.5 text-sm">
            <Row label={t("system.pluginSupport")}>
              <Badge variant={info.data?.plugin_support === "true" ? "default" : "outline"}>
                {info.data?.plugin_support ?? "—"}
              </Badge>
            </Row>
            <Row label={t("system.requestDb")}>
              <Badge variant={info.data?.request_db.enabled ? "default" : "destructive"}>
                {info.data?.request_db.enabled ? t("common.enabled") : t("common.disabled")}
              </Badge>
            </Row>
          </dl>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-8 text-xs"
            onClick={() => {
              useAuthStore.getState().clear();
              toast.success(t("system.clearedLocal"));
            }}
          >
            {t("system.clearLocalData")}
          </Button>
        </SectionCard>

        <SectionCard title={t("system.models")} hint={t("system.modelsHint")}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {CHANNELS.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="ghost"
                className={`h-7 rounded-full px-2.5 font-mono text-xs ${channel === name ? "bg-primary/10 text-primary hover:bg-primary/15" : ""}`}
                onClick={() => setChannel(name)}
              >
                {name}
              </Button>
            ))}
          </div>
          {models.isFetching ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{t("common.loading")}</p>
          ) : models.error ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{errMessage(models.error)}</p>
          ) : (
            <ModelList models={models.data ?? []} />
          )}
        </SectionCard>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function ModelList({ models }: { models: StaticModel[] }) {
  return (
    <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
      {models.map((model, index) => (
        <div key={model.id ?? index} className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-1.5 text-sm">
          <span className="truncate font-mono text-xs">{model.id ?? "?"}</span>
          {model.display_name ? <span className="text-muted-foreground shrink-0 pl-3 text-xs">{model.display_name}</span> : null}
        </div>
      ))}
    </div>
  );
}
