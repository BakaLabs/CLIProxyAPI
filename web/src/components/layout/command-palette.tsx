import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  BarChart3,
  Blocks,
  Coins,
  FileCode2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Moon,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sun,
  Terminal,
  UserCheck,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAuthStore } from "@/stores/auth";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const clearAuth = useAuthStore((state) => state.clear);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA")) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("common.search") + " (⌘K)..."} />
      <CommandList>
        <CommandEmpty>{t("common.empty")}</CommandEmpty>

        <CommandGroup heading={t("nav.observability")}>
          <CommandItem onSelect={() => runCommand(() => navigate("/"))}>
            <LayoutDashboard className="mr-2 size-4" />
            <span>{t("nav.dashboard")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/playground"))}>
            <Terminal className="mr-2 size-4 text-blue-500" />
            <span>{t("playground.title") || "接口调试"}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/request-logs"))}>
            <Activity className="mr-2 size-4" />
            <span>{t("nav.requestLogs")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/logs"))}>
            <ScrollText className="mr-2 size-4" />
            <span>{t("nav.logs")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("nav.providers")}>
          <CommandItem onSelect={() => runCommand(() => navigate("/providers"))}>
            <BarChart3 className="mr-2 size-4" />
            <span>{t("nav.providersItem")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/auth-files"))}>
            <KeyRound className="mr-2 size-4" />
            <span>{t("nav.authFiles")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/oauth"))}>
            <UserCheck className="mr-2 size-4" />
            <span>{t("nav.oauth")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/quota"))}>
            <Coins className="mr-2 size-4" />
            <span>{t("nav.quota")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("nav.management")}>
          <CommandItem onSelect={() => runCommand(() => navigate("/config"))}>
            <Settings2 className="mr-2 size-4" />
            <span>{t("nav.config")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/config?tab=yaml"))}>
            <FileCode2 className="mr-2 size-4" />
            <span>YAML 配置编辑</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/plugins"))}>
            <Blocks className="mr-2 size-4" />
            <span>{t("nav.plugins")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/system"))}>
            <ShieldCheck className="mr-2 size-4" />
            <span>{t("nav.systemItem")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("common.actions")}>
          <CommandItem onSelect={() => runCommand(() => setTheme(theme === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? <Sun className="mr-2 size-4" /> : <Moon className="mr-2 size-4" />}
            <span>切换暗色 / 浅色模式</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(clearAuth)}>
            <LogOut className="mr-2 size-4 text-destructive" />
            <span>{t("nav.logout")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
