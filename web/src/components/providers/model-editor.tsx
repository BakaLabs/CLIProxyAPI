// Shared model-list / excluded-models / fetch / combobox pieces used by both
// the OpenAI-compatible provider editor and the typed key-entry editors.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Check,
  ChevronsUpDown,
  CircleCheck,
  CircleX,
  FlaskConical,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fetchUpstreamModels, type ProbeResult, type UpstreamTarget } from "./provider-tools";
import i18n from "@/i18n";
import { maskKey } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ModelEntry = Record<string, unknown>;

export interface ModelFieldDef {
  key: string;
  labelKey: string;
  type: "string" | "number" | "switch" | "list" | "tri";
  placeholder?: string;
}

const COMPAT_MODEL_FIELDS: ModelFieldDef[] = [
  { key: "display-name", labelKey: "displayName", type: "string" },
  { key: "max-context-length", labelKey: "maxContextLength", type: "number" },
  { key: "input-modalities", labelKey: "inputModalities", type: "list", placeholder: "text, image" },
  { key: "output-modalities", labelKey: "outputModalities", type: "list", placeholder: "text" },
  { key: "image", labelKey: "imageModel", type: "switch" },
  { key: "force-mapping", labelKey: "forceMapping", type: "switch" },
  { key: "is-compat", labelKey: "isCompat", type: "switch" },
  { key: "use-max-completion-tokens", labelKey: "useMaxCompletionTokens", type: "switch" },
];
const GEMINI_MODEL_FIELDS: ModelFieldDef[] = [
  { key: "display-name", labelKey: "displayName", type: "string" },
  { key: "max-context-length", labelKey: "maxContextLength", type: "number" },
  { key: "is-compat", labelKey: "isCompat", type: "switch" },
  { key: "force-mapping", labelKey: "forceMapping", type: "switch" },
];
const CLAUDE_MODEL_FIELDS: ModelFieldDef[] = GEMINI_MODEL_FIELDS;
const CODEX_MODEL_FIELDS: ModelFieldDef[] = [
  { key: "display-name", labelKey: "displayName", type: "string" },
  { key: "max-context-length", labelKey: "maxContextLength", type: "number" },
  { key: "is-compat", labelKey: "isCompat", type: "switch" },
  { key: "force-mapping", labelKey: "forceMapping", type: "switch" },
  { key: "support-configuration-update", labelKey: "supportConfigurationUpdate", type: "switch" },
];
const VERTEX_MODEL_FIELDS: ModelFieldDef[] = [
  { key: "display-name", labelKey: "displayName", type: "string" },
  { key: "force-mapping", labelKey: "forceMapping", type: "switch" },
  { key: "openapi", labelKey: "modelOpenAPI", type: "tri" },
];

/** Advanced per-model fields by provider kind (matching the Go structs). */
export const MODEL_ADVANCED_FIELDS: Record<string, ModelFieldDef[]> = {
  "openai-compatibility": COMPAT_MODEL_FIELDS,
  gemini: GEMINI_MODEL_FIELDS,
  interactions: GEMINI_MODEL_FIELDS,
  claude: CLAUDE_MODEL_FIELDS,
  codex: CODEX_MODEL_FIELDS,
  xai: CODEX_MODEL_FIELDS,
  meta: CODEX_MODEL_FIELDS,
  vertex: VERTEX_MODEL_FIELDS,
};

/** Merge upstream model names into the list, deduped, alias defaulting to name. */
export function mergeModelNames(models: ModelEntry[], names: string[]): ModelEntry[] {
  const existing = new Set(models.map((model) => model.name));
  const additions = names
    .filter((name) => !existing.has(name))
    .map((name) => ({ name, alias: name }));
  if (additions.length === 0) {
    toast.info(i18n.t("providers.modelsAlreadyPresent"));
    return models;
  }
  toast.success(i18n.t("providers.modelsAdded", { count: additions.length }));
  return [...models, ...additions];
}

/** Drop nameless rows and default the alias to the name: the runtime resolves
 *  models by alias, so an empty alias would make the entry unreachable. */
export function normalizeModelsForSave(models: ModelEntry[]): ModelEntry[] {
  return models
    .map((model) => {
      const name = String(model.name ?? "").trim();
      const alias = String(model.alias ?? "").trim() || name;
      return { ...model, name, alias };
    })
    .filter((model) => model.name !== "");
}

/** name → alias rows with a per-kind advanced popover; shared by every editor. */
export function ModelRowsEditor({
  models,
  onChange,
  kindId,
}: {
  models: ModelEntry[];
  onChange: (next: ModelEntry[]) => void;
  kindId: string;
}) {
  const { t } = useTranslation();
  if (models.length === 0) {
    return <p className="text-muted-foreground rounded-xl border border-dashed border-border/60 px-4 py-5 text-center text-xs">{t("providers.emptyModels")}</p>;
  }
  return (
    <div className="space-y-1.5">
      {models.map((model, index) => {
        const setModel = (changes: ModelEntry) => {
          onChange(models.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)));
        };
        const name = String(model.name ?? "");
        const aliasDiffers = model.alias !== undefined && model.alias !== name;
        return (
          <div key={index} className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary/30 px-2 py-2">
            <Input
              className="h-8 flex-1 font-mono text-xs"
              value={name}
              onChange={(event) => setModel({ name: event.target.value })}
              placeholder="gpt-4o-mini"
            />
            <ArrowRight className="text-muted-foreground size-3.5 shrink-0" />
            <Input
              className="h-8 flex-1 font-mono text-xs"
              value={aliasDiffers ? String(model.alias ?? "") : ""}
              onChange={(event) => setModel({ alias: event.target.value || name })}
              placeholder={t("providers.aliasPlaceholder", { name })}
            />
            <ModelAdvancedPopover model={model} kindId={kindId} onChange={setModel} />
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive size-7 shrink-0"
              title={t("common.delete")}
              onClick={() => onChange(models.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function ModelAdvancedPopover({ model, kindId, onChange }: { model: ModelEntry; kindId: string; onChange: (changes: ModelEntry) => void }) {
  const { t } = useTranslation();
  const fields = MODEL_ADVANCED_FIELDS[kindId] ?? [];
  const advancedSet = fields.some((field) => {
    const value = model[field.key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7 shrink-0", advancedSet ? "text-primary" : "text-muted-foreground")}
          title={t("providers.modelAdvanced")}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        {fields.map((field) => (
          <ModelAdvancedField key={field.key} field={field} model={model} onChange={onChange} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ModelAdvancedField({ field, model, onChange }: { field: ModelFieldDef; model: ModelEntry; onChange: (changes: ModelEntry) => void }) {
  const { t } = useTranslation();
  const value = model[field.key];
  if (field.type === "switch") {
    return (
      <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
        <span>{t(`providers.${field.labelKey}`)}</span>
        <Switch checked={Boolean(value)} onCheckedChange={(checked) => onChange({ [field.key]: checked })} />
      </label>
    );
  }
  if (field.type === "tri") {
    return (
      <div className="flex items-center justify-between gap-3 text-xs">
        <span>{t(`providers.${field.labelKey}`)}</span>
        <Select
          value={value === undefined ? "unset" : value ? "on" : "off"}
          onValueChange={(next) => onChange({ [field.key]: next === "unset" ? undefined : next === "on" })}
        >
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unset">{t("providers.triFollow")}</SelectItem>
            <SelectItem value="on">{t("providers.triOn")}</SelectItem>
            <SelectItem value="off">{t("providers.triOff")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (field.type === "number") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{t(`providers.${field.labelKey}`)}</Label>
        <NumberValue
          value={typeof value === "number" ? value : undefined}
          onChange={(next) => onChange({ [field.key]: next })}
          placeholder="272000"
        />
      </div>
    );
  }
  if (field.type === "list") {
    const text = Array.isArray(value) ? value.join(", ") : "";
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{t(`providers.${field.labelKey}`)}</Label>
        <Input
          className="h-8 text-xs"
          value={text}
          placeholder={field.placeholder}
          onChange={(event) => {
            const parts = event.target.value.split(",").map((part) => part.trim()).filter(Boolean);
            onChange({ [field.key]: parts.length > 0 ? parts : undefined });
          }}
        />
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t(`providers.${field.labelKey}`)}</Label>
      <Input
        className="h-8 text-xs"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange({ [field.key]: event.target.value || undefined })}
      />
    </div>
  );
}

/** Numeric input that treats an empty value as "unset" (undefined). */
export function NumberValue({
  value,
  onChange,
  placeholder,
  className,
}: {
  value?: number;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(() => (value === undefined ? "" : String(value)));
  // Keep the text in sync when the value changes from outside (e.g. raw-JSON
  // apply) without clobbering in-progress typing like a lone "-".
  useEffect(() => {
    const parsed = text.trim() === "" || Number.isNaN(Number(text)) ? undefined : Number(text);
    if (parsed !== value) setText(value === undefined ? "" : String(value));
  }, [value, text]);
  return (
    <Input
      type="number"
      inputMode="numeric"
      className={cn("h-8 font-mono text-xs", className)}
      value={text}
      placeholder={placeholder}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const parsed = Number(raw);
        onChange(raw.trim() === "" || Number.isNaN(parsed) ? undefined : parsed);
      }}
    />
  );
}

/** Chips editor for per-entry excluded-models (string arrays on key entries). */
export function ExcludedModelsEditor({ values, onChange }: { values?: string[]; onChange: (next: string[] | undefined) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const list = values ?? [];
  const commit = () => {
    const trimmed = text.trim();
    setText("");
    if (!trimmed) return;
    if (list.includes(trimmed)) return;
    onChange([...list, trimmed]);
  };
  return (
    <div className="space-y-2">
      {list.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed border-border/60 px-4 py-4 text-center text-xs">{t("providers.excludedEmpty")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((value) => (
            <Badge key={value} variant="outline" className="gap-1 font-mono text-[11px]">
              {value}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(list.filter((item) => item !== value))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        className="h-8 font-mono text-xs"
        value={text}
        placeholder={t("providers.excludedPlaceholder")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

/** Searchable combobox for picking one model (connectivity chat test). */
export function ModelCombobox({
  value,
  onValueChange,
  options: optionsProp,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const options = [...new Set(optionsProp)];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-8 w-64 justify-between font-mono text-xs">
          <span className="truncate">{value || placeholder || t("providers.selectModel")}</span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={t("common.search")} />
          <CommandList>
            <CommandEmpty>{t("common.empty")}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option}
                value={option}
                onSelect={() => {
                  onValueChange(option);
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 size-3.5", option === value ? "opacity-100" : "opacity-0")} />
                <span className="font-mono">{option}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- model fetch

/** "从上游获取" entry point; lists upstream models and lets the user pick. */
export function FetchModelsButton({
  target,
  keys,
  proxyURL,
  onAdd,
}: {
  /** Kind metadata + base URL; the credential comes from `keys`. */
  target: Pick<UpstreamTarget, "baseURL" | "auth" | "modelsPath">;
  keys: string[];
  proxyURL?: string;
  onAdd: (names: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const usableKeys = keys.filter(Boolean);
  const disabled = !target.baseURL || usableKeys.length === 0;
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={disabled} title={disabled ? t("providers.fetchNeedsBaseURL") : undefined} onClick={() => setOpen(true)}>
        <FlaskConical className="size-3.5" />
        {t("providers.fetchModels")}
      </Button>
      {open ? (
        <FetchModelsDialog
          target={{ ...target, apiKey: "", proxyURL }}
          keys={usableKeys}
          onClose={() => setOpen(false)}
          onAdd={(names) => {
            onAdd(names);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function FetchModelsDialog({
  target,
  keys,
  onClose,
  onAdd,
}: {
  target: UpstreamTarget;
  keys: string[];
  onClose: () => void;
  onAdd: (names: string[]) => void;
}) {
  const { t } = useTranslation();
  const [keyIndex, setKeyIndex] = useState("0");
  const [busy, setBusy] = useState(false);
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const run = async () => {
    setBusy(true);
    try {
      const names = await fetchUpstreamModels({ ...target, apiKey: keys[Number(keyIndex)] ?? "" });
      setFetched(names);
      setSelected(new Set(names));
      if (names.length === 0) toast.info(t("providers.fetchedEmpty"));
      else toast.success(t("providers.fetchedCount", { count: names.length }));
    } catch (error) {
      toast.error(t("providers.fetchFailed"), { description: String((error as Error).message ?? error).slice(0, 200) });
    } finally {
      setBusy(false);
    }
  };

  const visible = (fetched ?? []).filter((name) => name.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (name: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-xl!">
        <DialogHeader className="pb-4">
          <DialogTitle>{t("providers.fetchModelsTitle")}</DialogTitle>
          <p className="text-muted-foreground text-xs">{t("providers.fetchModelsHint")}</p>
        </DialogHeader>
        <div className="flex items-center gap-2 pb-4">
          {keys.length > 1 ? (
            <Select value={keyIndex} onValueChange={setKeyIndex}>
              <SelectTrigger className="h-8 w-56 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {keys.map((key, index) => (
                  <SelectItem key={index} value={String(index)} className="font-mono text-xs">
                    {maskKey(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button size="sm" className="h-8 text-xs" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
            {t("providers.fetch")}
          </Button>
        </div>
        {fetched !== null ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <Input className="h-8 text-xs flex-1 rounded-xl" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t("common.search")} />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs rounded-xl"
                onClick={() => {
                  setSelected(new Set(visible));
                }}
              >
                {t("common.all") || "全选"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs rounded-xl text-slate-500"
                onClick={() => setSelected(new Set())}
              >
                {t("common.none") || "清空"}
              </Button>
            </div>
            <div className="text-muted-foreground flex items-center justify-between px-1 pb-1.5 text-[11px]">
              <span>已选 {selected.size} / 可用 {visible.length} 个模型</span>
            </div>
            <div className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1 max-h-96">
              {visible.map((name) => (
                <label key={name} className="hover:bg-secondary/60 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition">
                  <Checkbox checked={selected.has(name)} onCheckedChange={(checked) => toggle(name, checked === true)} />
                  <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
                </label>
              ))}
              {visible.length === 0 ? <p className="text-muted-foreground py-6 text-center text-xs">{t("common.empty")}</p> : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <FlaskConical className="size-8 text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-muted-foreground text-xs">{t("providers.fetchIdle")}</p>
          </div>
        )}
        <DialogFooter className="pt-4">
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" className="h-8" disabled={selected.size === 0} onClick={() => onAdd([...selected])}>
            <Plus className="size-3.5" />
            {t("providers.addSelected", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------- probe badges

/** Success / failure pill for one upstream probe result. */
export function ProbeStatusBadge({ result, busy, label, code, compact }: { result?: ProbeResult; busy?: boolean; label?: string; code?: number; compact?: boolean }) {
  const { t } = useTranslation();
  if (busy) {
    return (
      <Badge variant="outline" className={cn("gap-1 text-[10px]", compact && "h-6 px-1.5")}>
        <Loader2 className="size-3 animate-spin shrink-0" />
        {label}
      </Badge>
    );
  }
  if (!result) {
    if (compact) {
      return <span className="text-muted-foreground/40 text-center font-mono text-xs select-none">—</span>;
    }
    return label ? <Badge variant="outline" className="text-muted-foreground text-[10px]">{label}</Badge> : null;
  }
  if (result.ok) {
    return (
      <Badge
        variant="outline"
        className={cn("gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400", compact && "h-6 px-1.5")}
      >
        <CircleCheck className="size-3 shrink-0" />
        {compact ? (code ?? result.code ?? "200") : label ?? t("providers.probeOk", { code: code ?? result.code })}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-rose-500/40 bg-rose-500/10 text-[10px] text-rose-600 dark:text-rose-400", compact && "h-6 px-1.5")}
      title={result.message ?? undefined}
    >
      <CircleX className="size-3 shrink-0" />
      {compact ? (result.code ?? "ERR") : label ?? t("providers.probeFail", { code: result.code ?? "?" })}
    </Badge>
  );
}

// ------------------------------------------------------------- scoped errors

/** Raw JSON editing for the request-scoped-errors rules array. */
export function ScopedErrorsEditor({ value, onChange }: { value?: unknown[]; onChange: (value: unknown[] | undefined) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 2) : ""));
  const [dirty, setDirty] = useState(false);
  return (
    <div className="space-y-2">
      <textarea
        className="bg-secondary/50 h-40 w-full resize-y rounded-xl border border-border/60 p-3 font-mono text-xs"
        value={text}
        spellCheck={false}
        placeholder='[{"match": "...", "status-code": 500}]'
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
        }}
      />
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={!dirty}
          onClick={() => {
            if (!text.trim()) {
              onChange(undefined);
              setDirty(false);
              return;
            }
            try {
              const parsed = JSON.parse(text);
              if (!Array.isArray(parsed)) throw new Error("expected an array");
              onChange(parsed);
              setDirty(false);
              toast.success(t("common.saved"));
            } catch (error) {
              toast.error(String(error));
            }
          }}
        >
          {t("common.apply")}
        </Button>
      </div>
    </div>
  );
}
