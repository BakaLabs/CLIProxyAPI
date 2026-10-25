import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleUserRound, Copy, ExternalLink, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/misc";
import { OAUTH_PROVIDERS, credentials, oauth, plugins } from "@/api/management";
import { errMessage } from "@/api/types";

interface ActiveFlow {
  state: string;
  provider: string;
  kind: "browser" | "device" | "plugin" | "siwc";
  url?: string;
  userCode?: string;
}

export function OAuthPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [flows, setFlows] = useState<ActiveFlow[]>([]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["auth-files"] });

  const installed = useQuery({ queryKey: ["plugins"], queryFn: plugins.list, staleTime: 30_000 });
  const pluginProviders = (installed.data ?? []).filter((plugin) => plugin.supports_oauth);

  const start = useMutation({
    mutationFn: async ({ provider, kind, isPlugin }: { provider: string; kind: "browser" | "device" | "plugin"; isPlugin?: boolean }) => {
      const response = await oauth.start(provider, { isWebUI: kind === "browser" && !isPlugin });
      return { response, kind, provider };
    },
    onSuccess: ({ response, kind, provider }) => {
      setFlows((current) => [
        ...current,
        { state: response.state, provider: response.flow === "siwc_bind" ? `${provider} (SIWC)` : provider, kind, url: response.url, userCode: response.user_code },
      ]);
      if (kind === "browser" && response.url) {
        window.open(response.url, "_blank", "noopener");
      }
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  const startSIWC = useMutation({
    mutationFn: (name: string) => oauth.siwcBind(name),
    onSuccess: (response) => {
      setFlows((current) => [...current, { state: response.state, provider: "codex (SIWC)", kind: "siwc", url: response.url }]);
      if (response.url) window.open(response.url, "_blank", "noopener");
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  const importVertex = useMutation({
    mutationFn: ({ file, location }: { file: File; location: string }) => oauth.importVertex(file, location),
    onSuccess: (result) => {
      toast.success(t("oauth.vertexImported", { project: result.project_id ?? "" }));
      invalidate();
    },
    onError: (error) => toast.error(errMessage(error)),
  });

  const removeFlow = (state: string) => setFlows((current) => current.filter((flow) => flow.state !== state));

  return (
    <>
      <PageHeader title={t("nav.oauth")} subtitle={t("oauth.subtitle")} />

      <SectionCard title={t("oauth.providers")} hint={t("oauth.providersHint")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {OAUTH_PROVIDERS.map((spec) => (
            <ProviderTile
              key={spec.id}
              id={spec.id}
              hint={spec.flow === "device" ? t("oauth.deviceFlow") : t("oauth.browserFlow")}
              busy={start.isPending && start.variables?.provider === spec.id}
              onClick={() => start.mutate({ provider: spec.id, kind: spec.flow })}
            />
          ))}
          {pluginProviders.map((plugin) => (
            <ProviderTile
              key={plugin.id}
              id={plugin.oauth_provider || plugin.id}
              hint={t("oauth.pluginFlow")}
              busy={start.isPending && start.variables?.provider === (plugin.oauth_provider || plugin.id)}
              onClick={() => start.mutate({ provider: plugin.oauth_provider || plugin.id, kind: "plugin", isPlugin: true })}
            />
          ))}
        </div>
      </SectionCard>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title={t("oauth.vertexImport")} hint={t("oauth.vertexImportHint")}>
          <VertexImport onImport={(file, location) => importVertex.mutate({ file, location })} busy={importVertex.isPending} />
        </SectionCard>

        <SectionCard title={t("oauth.siwc")} hint={t("oauth.siwcHint")}>
          <SIWCBind onBind={(name) => startSIWC.mutate(name)} busy={startSIWC.isPending} />
        </SectionCard>
      </div>

      {flows.length > 0 ? (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-semibold">{t("oauth.activeFlows")}</h3>
          {flows.map((flow) => (
            <FlowCard key={flow.state} flow={flow} onDone={() => { removeFlow(flow.state); invalidate(); }} onCancel={() => removeFlow(flow.state)} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function ProviderTile({ id, hint, busy, onClick }: { id: string; hint: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-5 animate-spin" /> : <CircleUserRound className="size-5" />}
      <span className="font-mono text-sm">{id}</span>
      <span className="text-muted-foreground text-[10px]">{hint}</span>
    </button>
  );
}

function FlowCard({ flow, onDone, onCancel }: { flow: ActiveFlow; onDone: () => void; onCancel: (cancelRemote: boolean) => void }) {
  const { t } = useTranslation();
  const [callbackURL, setCallbackURL] = useState("");
  const status = useQuery({
    queryKey: ["oauth-status", flow.state],
    queryFn: () => oauth.status(flow.state),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  });

  // Terminal states close the flow card and surface a toast.
  useEffect(() => {
    const data = status.data;
    if (!data) return;
    if (data.status === "ok") {
      toast.success(t("oauth.success", { provider: flow.provider }));
      onDone();
    } else if (data.status === "error") {
      toast.error(t("oauth.failed", { provider: flow.provider, message: data.error }));
      onCancel(false);
    }
  }, [status.data]);

  const submitCallback = useMutation({
    mutationFn: () => oauth.callback({ redirect_url: callbackURL.trim(), state: flow.state, provider: flow.provider.split("/")[0] }),
    onSuccess: () => toast.success(t("oauth.callbackSubmitted")),
    onError: (error) => toast.error(errMessage(error)),
  });

  const cancel = async () => {
    try {
      await oauth.cancel(flow.state);
    } catch {
      // Best-effort; the session expires on its own.
    }
    onCancel(false);
  };

  return (
    <Card className="gap-0 py-3">
      <CardContent className="space-y-2.5 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Loader2 className="size-4 animate-spin text-amber-500" />
            <span className="font-mono text-sm">{flow.provider}</span>
            <Badge variant="outline" className="text-[10px]">{flow.kind}</Badge>
            <span className="text-muted-foreground truncate font-mono text-xs">{flow.state.slice(0, 8)}…</span>
          </div>
          <div className="flex items-center gap-1">
            {flow.url ? (
              <Button variant="ghost" size="icon" className="size-7" onClick={() => window.open(flow.url, "_blank", "noopener")}>
                <ExternalLink className="size-3.5" />
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" className="text-destructive size-7" onClick={() => void cancel()}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {flow.userCode ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">{t("oauth.userCode")}:</span>
            <code className="bg-muted rounded px-2 py-0.5 font-mono text-sm tracking-widest">{flow.userCode}</code>
            <CopyButtonSmall text={flow.userCode} />
            {flow.url ? (
              <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => window.open(flow.url, "_blank", "noopener")}>
                {t("oauth.visit")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {flow.kind !== "device" ? (
          <div className="flex items-center gap-2">
            <Input
              value={callbackURL}
              onChange={(event) => setCallbackURL(event.target.value)}
              placeholder={t("oauth.callbackPlaceholder")}
              className="h-7 font-mono text-xs"
            />
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!callbackURL.trim() || submitCallback.isPending} onClick={() => submitCallback.mutate()}>
              {t("oauth.submitCallback")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CopyButtonSmall({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      title={t("common.copy")}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        toast.success(t("common.copied"));
      }}
    >
      <Copy className="size-3.5" />
    </Button>
  );
}

function VertexImport({ onImport, busy }: { onImport: (file: File, location: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState("us-central1");
  return (
    <div className="space-y-3">
      <Label className="text-xs">{t("oauth.serviceAccount")}</Label>
      <Input
        type="file"
        accept=".json,application/json"
        className="h-9 text-xs"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <div className="space-y-1">
        <Label className="text-muted-foreground text-[10px]">location</Label>
        <Input value={location} onChange={(event) => setLocation(event.target.value)} className="h-8 text-xs font-mono" />
      </div>
      <Button size="sm" className="h-8 w-full text-xs" disabled={!file || busy} onClick={() => file && onImport(file, location)}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        {t("oauth.importVertex")}
      </Button>
    </div>
  );
}

function SIWCBind({ onBind, busy }: { onBind: (name: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const credentialCheck = useQuery({ queryKey: ["auth-files"], queryFn: () => credentials.list(), staleTime: 30_000 });
  const names = (credentialCheck.data?.files ?? []).filter((entry) => String(entry.provider).includes("codex")).map((entry) => entry.name);
  return (
    <div className="space-y-3">
      <Label className="text-xs">{t("oauth.siwcCredential")}</Label>
      <Input value={name} onChange={(event) => setName(event.target.value)} list="siwc-names" placeholder="auth file name" className="h-8 font-mono text-xs" />
      <datalist id="siwc-names">
        {names.map((candidate) => (
          <option key={candidate} value={candidate} />
        ))}
      </datalist>
      <Button size="sm" className="h-8 w-full text-xs" disabled={!name.trim() || busy} onClick={() => onBind(name.trim())}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {t("oauth.siwcBind")}
      </Button>
    </div>
  );
}
