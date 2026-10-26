import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { useAuthStore } from "@/stores/auth";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { RequestLogsPage } from "@/pages/request-logs";
import { ProvidersPage } from "@/pages/providers";
import { AuthFilesPage } from "@/pages/auth-files";
import { OAuthPage } from "@/pages/oauth";
import { QuotaPage } from "@/pages/quota";
import { ConfigPage } from "@/pages/config";
import { FileLogsPage } from "@/pages/file-logs";
import { PluginsPage } from "@/pages/plugins";
import { PluginPages } from "@/pages/plugin-pages";
import { SystemPage } from "@/pages/system";
import { PlaygroundPage } from "@/pages/playground";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const key = useAuthStore((state) => state.key);
  const location = useLocation();
  if (!key) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <TooltipProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/request-logs" element={<RequestLogsPage />} />
              <Route path="/logs" element={<FileLogsPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/auth-files" element={<AuthFilesPage />} />
              <Route path="/oauth" element={<OAuthPage />} />
              <Route path="/quota" element={<QuotaPage />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/plugins" element={<PluginsPage />} />
              <Route path="/plugin-pages" element={<PluginPages />} />
              <Route path="/plugin-pages/:pluginId/:menuIndex" element={<PluginPages />} />
              <Route path="/system" element={<SystemPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TooltipProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}
