import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Code2, Copy, Cpu, Search, Sparkles, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ModelEntry } from "./model-editor";
import type { KindMeta } from "./provider-tools";

interface ProviderModelsDialogProps {
  open: boolean;
  onClose: () => void;
  providerName: string;
  kind: KindMeta;
  models: ModelEntry[];
}

export function ProviderModelsDialog({
  open,
  onClose,
  providerName,
  kind,
  models,
}: ProviderModelsDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [copiedName, setCopiedName] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return models;
    return models.filter((m) => {
      const name = String(m.name ?? "").toLowerCase();
      const alias = String(m.alias ?? "").toLowerCase();
      const display = String(m["display-name"] ?? "").toLowerCase();
      return name.includes(term) || alias.includes(term) || display.includes(term);
    });
  }, [models, search]);

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedName(text);
    toast.success(t("providers.dialogs.copiedName", { name: text }));
    setTimeout(() => setCopiedName(null), 1500);
  };

  const handleDebug = (modelName: string) => {
    onClose();
    navigate(`/playground?model=${encodeURIComponent(modelName)}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-2xl! rounded-2xl">
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
              <Cpu className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t("providers.dialogs.modelsTitle", { name: providerName || t(`providers.kind.${kind.labelKey}`) })}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400 mt-0.5">
                {t("providers.dialogs.modelsDesc", { count: models.length })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Search Bar */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/60">
          <div className="relative">
            <Search className="text-slate-400 pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              className="h-8.5 rounded-xl pl-8.5 text-xs bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("providers.dialogs.modelsSearchPlaceholder")}
            />
          </div>
        </div>

        {/* Models List Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {models.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Sparkles className="size-8 text-amber-400 mb-2" />
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {t("providers.dialogs.noModelsRestricted")}
              </p>
              <p className="text-xs text-slate-400 max-w-sm mt-1 leading-relaxed">
                {t("providers.dialogs.noModelsRestrictedDesc")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 rounded-xl text-xs gap-1.5"
                onClick={() => handleDebug("gpt-4o")}
              >
                <Terminal className="size-3.5" />
                <span>{t("providers.dialogs.debugDefault")}</span>
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-xs">
              {t("common.empty")}
            </p>
          ) : (
            filtered.map((model, idx) => {
              const name = String(model.name ?? "");
              const alias = String(model.alias ?? "");
              const hasAlias = alias && alias !== name;

              return (
                <div
                  key={`${name}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white p-3 dark:border-slate-800/70 dark:bg-slate-900/60 hover:shadow-xs transition"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {name || t("common.unknown")}
                      </span>
                      {Boolean(model["display-name"]) && (
                        <span className="text-[11px] text-slate-400 font-medium">
                          ({String(model["display-name"])})
                        </span>
                      )}
                    </div>

                    {hasAlias && (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-slate-400">{t("providers.modelAlias")}:</span>
                        <Badge variant="outline" className="font-mono text-[10px] text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-950/40 dark:border-purple-800/40">
                          {alias}
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs rounded-lg gap-1"
                      onClick={() => handleCopy(alias || name)}
                    >
                      {copiedName === (alias || name) ? (
                        <Check className="size-3 text-emerald-500" />
                      ) : (
                        <Copy className="size-3 text-slate-400" />
                      )}
                      <span>{t("providers.dialogs.copyName")}</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs rounded-lg gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                      onClick={() => handleDebug(alias || name)}
                    >
                      <Terminal className="size-3" />
                      <span>{t("providers.debug")}</span>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------- Quick cURL Dialog

interface ProviderCurlDialogProps {
  open: boolean;
  onClose: () => void;
  providerName: string;
  defaultModel: string;
}

export function ProviderCurlDialog({
  open,
  onClose,
  providerName,
  defaultModel,
}: ProviderCurlDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const host = typeof window !== "undefined" ? window.location.origin : "http://localhost:8317";
  const model = defaultModel || "gpt-4o";

  const curlSnippet = `curl -X POST "${host}/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_CPA_ACCESS_KEY" \\
  -d '{
    "model": "${model}",
    "messages": [
      {"role": "user", "content": "Hello CLIProxyAPI!"}
    ],
    "stream": true
  }'`;

  const pythonSnippet = `from openai import OpenAI

# Connect to CLIProxyAPI Gateway
client = OpenAI(
    base_url="${host}/v1",
    api_key="YOUR_CPA_ACCESS_KEY",
)

response = client.chat.completions.create(
    model="${model}",
    messages=[
        {"role": "user", "content": "Hello CLIProxyAPI!"}
    ],
    stream=True,
)

for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)
`;

  const handleCopy = (code: string) => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success(t("providers.dialogs.copiedCode"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-2xl! rounded-2xl">
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Code2 className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t("providers.dialogs.curlTitle", { name: providerName })}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400 mt-0.5">
                {t("providers.dialogs.curlDesc")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Tabs defaultValue="curl" className="w-full">
            <div className="flex items-center justify-between mb-3">
              <TabsList className="rounded-xl h-8">
                <TabsTrigger value="curl" className="text-xs rounded-lg">{t("providers.dialogs.tabCurl")}</TabsTrigger>
                <TabsTrigger value="python" className="text-xs rounded-lg">{t("providers.dialogs.tabPython")}</TabsTrigger>
                <TabsTrigger value="clients" className="text-xs rounded-lg">{t("providers.dialogs.tabClients")}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="curl" className="space-y-2 mt-0">
              <div className="relative rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-100 border border-slate-800">
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-2.5 right-2.5 h-7 px-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  onClick={() => handleCopy(curlSnippet)}
                >
                  {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  <span className="ml-1">{t("common.copy")}</span>
                </Button>
                <pre className="overflow-x-auto whitespace-pre-wrap">{curlSnippet}</pre>
              </div>
            </TabsContent>

            <TabsContent value="python" className="space-y-2 mt-0">
              <div className="relative rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-100 border border-slate-800">
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-2.5 right-2.5 h-7 px-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  onClick={() => handleCopy(pythonSnippet)}
                >
                  {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  <span className="ml-1">{t("common.copy")}</span>
                </Button>
                <pre className="overflow-x-auto whitespace-pre-wrap">{pythonSnippet}</pre>
              </div>
            </TabsContent>

            <TabsContent value="clients" className="space-y-3 mt-0">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/60 p-4 space-y-3 text-xs">
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  支持 NextChat、LobeChat、Cursor、Cherry Studio、Claude Code 等接入：
                </p>
                <div className="space-y-2 font-mono">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 font-sans">接口地址 (Base URL):</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400">{host}/v1</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 font-sans">API Key:</span>
                    <span className="text-slate-700 dark:text-slate-300">任意非空字符 (或你的 CPA 访问密钥)</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 font-sans">模型名称:</span>
                    <span className="font-bold text-purple-600 dark:text-purple-400">{model}</span>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
