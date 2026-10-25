import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Download, Eraser, PauseCircle, PlayCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/misc";
import { fileLogs } from "@/api/management";
import { errMessage, errStatus } from "@/api/types";
import { formatBytes } from "@/lib/format";

const PAGE_LINES = 800;

export function FileLogsPage() {
  const { t } = useTranslation();
  const [follow, setFollow] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const cursorRef = useRef<string | undefined>(undefined);
  const [lines, setLines] = useState<{ text: string; stamp: number }[]>([]);
  const lastHandled = useRef<string>("");

  const tail = useQuery({
    queryKey: ["file-logs", cursorRef.current],
    queryFn: async () => {
      const response = await fileLogs.lines({ limit: PAGE_LINES, cursor: cursorRef.current });
      return response;
    },
    refetchInterval: follow ? 2000 : false,
  });

  // Append incremental lines as they arrive; a cursor reset clears the buffer.
  const response = tail.data;
  const responseKey = response ? `${response["next-cursor"] ?? ""}:${response.lines.length}` : "";
  useEffect(() => {
    if (!response) return;
    if (response["cursor-reset"]) {
      cursorRef.current = response["next-cursor"];
      setLines(response.lines.map((text, index) => ({ text, stamp: response["latest-timestamp"] + index })));
      lastHandled.current = responseKey;
      return;
    }
    if (response.lines.length === 0) return;
    cursorRef.current = response["next-cursor"];
    lastHandled.current = responseKey;
    setLines((previous) => [...previous, ...response.lines.map((text, index) => ({ text, stamp: response["latest-timestamp"] + index }))].slice(-20_000));
  }, [response, responseKey]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return lines;
    const needle = debouncedSearch.toLowerCase();
    return lines.filter((line) => line.text.toLowerCase().includes(needle));
  }, [lines, debouncedSearch]);

  const errorLogs = useQuery({ queryKey: ["error-logs"], queryFn: fileLogs.errorLogs, refetchInterval: 15_000 });

  const clearLogs = async () => {
    try {
      await fileLogs.clear();
      setLines([]);
      cursorRef.current = undefined;
      lastHandled.current = "";
      await tail.refetch();
      toast.success(t("logs.cleared"));
    } catch (error) {
      toast.error(errMessage(error));
    }
  };

  return (
    <>
      <PageHeader title={t("nav.logs")} subtitle={t("logs.subtitle")}>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("logs.search")} className="h-8 w-52 pl-8 text-xs" />
        </div>
        <Button
          variant={follow ? "default" : "outline"}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setFollow(!follow)}
        >
          {follow ? <PauseCircle className="size-3.5" /> : <PlayCircle className="size-3.5" />}
          {follow ? t("common.pause") : t("common.resume")}
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-destructive" onClick={clearLogs}>
          <Eraser className="size-3.5" />
          {t("logs.clear")}
        </Button>
      </PageHeader>

      {tail.error && errStatus(tail.error) === 400 ? (
        <div className="text-muted-foreground border-border bg-muted/30 rounded-xl border border-dashed px-6 py-16 text-center text-sm">
          {t("logs.fileLoggingDisabled")}
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="max-h-[calc(100vh-20rem)] overflow-auto p-3">
            <pre className="font-mono text-xs leading-relaxed">
              {filtered.map((line, index) => (
                <div key={index} className={lineClass(line.text)}>
                  {line.text}
                </div>
              ))}
              {filtered.length === 0 ? <span className="text-muted-foreground">{t("common.noData")}</span> : null}
            </pre>
          </div>
          <div className="text-muted-foreground border-t px-3 py-1.5 text-xs">
            {formatIntShort(filtered.length)} / {formatIntShort(lines.length)} {t("logs.lines")}
            {follow ? <Badge variant="outline" className="ml-2 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">{t("common.live")}</Badge> : null}
          </div>
        </div>
      )}

      <div className="mt-4">
        <SectionCard title={t("logs.errorFiles")} hint={t("logs.errorFilesHint")}>
          {errorLogs.data && errorLogs.data.length > 0 ? (
            <div className="space-y-1.5">
              {errorLogs.data.map((file) => (
                <div key={file.name} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <AlertCircle className="shrink-0 text-rose-500" />
                    <span className="truncate font-mono text-xs">{file.name}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">{formatBytes(file.size)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={async () => {
                      try {
                        await fileLogs.downloadErrorLog(file.name);
                      } catch (error) {
                        toast.error(errMessage(error));
                      }
                    }}
                  >
                    <Download className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground py-4 text-center text-sm">{t("logs.noErrorFiles")}</p>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function formatIntShort(value: number): string {
  return value.toLocaleString("en");
}

function lineClass(text: string): string {
  const lowered = text.toLowerCase();
  if (lowered.includes("[error]") || lowered.includes("error=") || lowered.startsWith("error")) return "text-rose-500";
  if (lowered.includes("[warn]") || lowered.includes("warning")) return "text-amber-500";
  if (lowered.includes("[debug]")) return "text-muted-foreground";
  return "";
}
