import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { providerLists } from "@/api/management";
import { errMessage } from "@/api/types";

/** OAuth channels that can carry alias / exclusion rules. */
const OAUTH_CHANNELS = ["gemini", "gemini-interactions", "claude", "codex", "antigravity", "vertex", "aistudio", "kimi", "xai", "devin", "meta"];

// ------------------------------------------------------------ model alias

interface AliasEntry {
  name: string;
  alias: string;
  fork?: boolean;
  "display-name"?: string;
}

/** Structured editor for oauth-model-alias: channel → [{name, alias, ...}]. */
export function ModelAliasDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, AliasEntry[]> | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    providerLists
      .getMap<Record<string, AliasEntry[]>>("oauth-model-alias", "oauth-model-alias")
      .then((data) => !cancelled && setDraft(data))
      .catch((error) => {
        if (!cancelled) {
          toast.error(errMessage(error));
          setDraft({});
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const channels = draft ? Object.keys(draft) : [];
  const addable = OAUTH_CHANNELS.filter((channel) => !channels.includes(channel));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await providerLists.putMap("oauth-model-alias", draft);
      toast.success(t("common.saved"));
      onClose();
    } catch (error) {
      toast.error(errMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-3xl!">
        <DialogHeader className="pb-4">
          <DialogTitle>{t("providers.modelAlias")}</DialogTitle>
          <p className="text-muted-foreground text-xs">{t("providers.aliasHint")}</p>
        </DialogHeader>
        <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
          {loading || draft === null ? (
            <p className="text-muted-foreground py-10 text-center text-xs">{t("common.loading")}</p>
          ) : (
            <>
              {channels.map((channel) => {
                const rows = draft[channel] ?? [];
                const setChannel = (next: AliasEntry[]) => setDraft({ ...draft, [channel]: next });
                return (
                  <div key={channel} className="card-surface p-3">
                    <div className="mb-2.5 flex items-center justify-between">
                      <p className="font-mono text-xs font-semibold">{channel}</p>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setChannel([...rows, { name: "", alias: "" }])}
                        >
                          <Plus className="size-3.5" />
                          {t("providers.addModel")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive size-7"
                          title={t("providers.removeChannel")}
                          onClick={() => {
                            const next = { ...draft };
                            delete next[channel];
                            setDraft(next);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    {rows.length === 0 ? (
                      <p className="text-muted-foreground text-xs">{t("common.empty")}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {rows.map((row, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              className="h-8 min-w-0 flex-1 font-mono text-xs"
                              value={row.name}
                              placeholder={t("providers.aliasSourceName")}
                              onChange={(event) => {
                                const next = [...rows];
                                next[index] = { ...row, name: event.target.value };
                                setChannel(next);
                              }}
                            />
                            <Input
                              className="h-8 min-w-0 flex-1 font-mono text-xs"
                              value={row.alias}
                              placeholder={t("providers.aliasTargetName")}
                              onChange={(event) => {
                                const next = [...rows];
                                next[index] = { ...row, alias: event.target.value };
                                setChannel(next);
                              }}
                            />
                            <Input
                              className="hidden h-8 min-w-0 flex-1 font-mono text-xs lg:block"
                              value={row["display-name"] ?? ""}
                              placeholder={t("providers.displayName")}
                              onChange={(event) => {
                                const next = [...rows];
                                next[index] = { ...row, "display-name": event.target.value || undefined };
                                setChannel(next);
                              }}
                            />
                            <label className="flex shrink-0 items-center gap-1.5 text-xs">
                              <span className="text-muted-foreground hidden xl:inline">{t("providers.fork")}</span>
                              <Switch
                                checked={Boolean(row.fork)}
                                onCheckedChange={(checked) => {
                                  const next = [...rows];
                                  next[index] = { ...row, fork: checked || undefined };
                                  setChannel(next);
                                }}
                              />
                            </label>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive size-7 shrink-0"
                              onClick={() => setChannel(rows.filter((_, i) => i !== index))}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {addable.length > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">{t("providers.addChannel")}</span>
                  <Select
                    value=""
                    onValueChange={(channel) => setDraft({ ...draft, [channel]: [] })}
                  >
                    <SelectTrigger className="h-8 w-52 text-xs">
                      <SelectValue placeholder={t("providers.channel")} />
                    </SelectTrigger>
                    <SelectContent>
                      {addable.map((channel) => (
                        <SelectItem key={channel} value={channel} className="font-mono text-xs">
                          {channel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter className="pt-4">
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" className="h-8" onClick={save} disabled={saving || draft === null}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------- excluded models

/** Structured editor for oauth-excluded-models: channel → patterns. */
export function ExcludedModelsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string[]> | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    providerLists
      .getMap<Record<string, string[]>>("oauth-excluded-models", "oauth-excluded-models")
      .then((data) => !cancelled && setDraft(data))
      .catch((error) => {
        if (!cancelled) {
          toast.error(errMessage(error));
          setDraft({});
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await providerLists.putMap("oauth-excluded-models", draft);
      toast.success(t("common.saved"));
      onClose();
    } catch (error) {
      toast.error(errMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const channels = draft ? Object.keys(draft) : [];
  const addable = OAUTH_CHANNELS.filter((channel) => !channels.includes(channel));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-2xl!">
        <DialogHeader className="pb-4">
          <DialogTitle>{t("providers.excludedModels")}</DialogTitle>
          <p className="text-muted-foreground text-xs">{t("providers.excludedHint")}</p>
        </DialogHeader>
        <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
          {loading || draft === null ? (
            <p className="text-muted-foreground py-10 text-center text-xs">{t("common.loading")}</p>
          ) : (
            <>
              {channels.map((channel) => {
                const patterns = draft[channel] ?? [];
                return (
                  <div key={channel} className="card-surface p-3">
                    <div className="mb-2.5 flex items-center justify-between">
                      <p className="font-mono text-xs font-semibold">{channel}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive size-7"
                        title={t("providers.removeChannel")}
                        onClick={() => {
                          const next = { ...draft };
                          delete next[channel];
                          setDraft(next);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {patterns.map((pattern, index) => (
                        <span key={`${pattern}-${index}`} className="bg-secondary inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-xs">
                          {pattern}
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setDraft({ ...draft, [channel]: patterns.filter((_, i) => i !== index) })}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                      <Input
                        className="h-7 w-48 font-mono text-xs"
                        value={pending[channel] ?? ""}
                        placeholder={t("providers.patternPlaceholder")}
                        onChange={(event) => setPending({ ...pending, [channel]: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          const value = (pending[channel] ?? "").trim();
                          if (!value) return;
                          setDraft({ ...draft, [channel]: [...patterns, value] });
                          setPending({ ...pending, [channel]: "" });
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {addable.length > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">{t("providers.addChannel")}</span>
                  <Select value="" onValueChange={(channel) => setDraft({ ...draft, [channel]: [] })}>
                    <SelectTrigger className="h-8 w-52 text-xs">
                      <SelectValue placeholder={t("providers.channel")} />
                    </SelectTrigger>
                    <SelectContent>
                      {addable.map((channel) => (
                        <SelectItem key={channel} value={channel} className="font-mono text-xs">
                          {channel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter className="pt-4">
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" className="h-8" onClick={save} disabled={saving || draft === null}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------- access keys

/** Row editor for the client-facing api-keys list. */
export function AccessKeysDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    providerLists
      .getList<string>("api-keys", "api-keys")
      .then((data) => !cancelled && setItems(data))
      .catch((error) => {
        if (!cancelled) {
          toast.error(errMessage(error));
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!items) return;
    setSaving(true);
    try {
      await providerLists.putList("api-keys", items.filter((key) => key.trim()));
      toast.success(t("common.saved"));
      onClose();
    } catch (error) {
      toast.error(errMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleReveal = (index: number) => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 sm:max-w-xl!">
        <DialogHeader className="pb-4">
          <DialogTitle>{t("providers.accessKeys")}</DialogTitle>
          <p className="text-muted-foreground text-xs">{t("providers.accessKeysHint")}</p>
        </DialogHeader>
        <div className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1">
          {items === null ? (
            <p className="text-muted-foreground py-10 text-center text-xs">{t("common.loading")}</p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-xs">{t("common.empty")}</p>
          ) : (
            items.map((key, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-muted-foreground w-6 text-center text-xs">{index + 1}</span>
                <div className="relative min-w-0 flex-1">
                  <Input
                    className="h-8 pr-8 font-mono text-xs"
                    type={revealed.has(index) ? "text" : "password"}
                    autoComplete="off"
                    value={key}
                    onChange={(event) => {
                      const next = [...items];
                      next[index] = event.target.value;
                      setItems(next);
                    }}
                  />
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                    onClick={() => toggleReveal(index)}
                  >
                    {revealed.has(index) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive size-7"
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="pt-3">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setItems([...(items ?? []), ""])}>
            <Plus className="size-3.5" />
            {t("common.add")}
          </Button>
        </div>
        <DialogFooter className="pt-4">
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" className="h-8" onClick={save} disabled={saving || items === null}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
