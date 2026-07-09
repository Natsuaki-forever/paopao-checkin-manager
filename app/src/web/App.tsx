import { useEffect, useState } from "react";
import type { AuthState } from "../shared/types";
import { api, postJson } from "./api";
import { AppShell, type PageId } from "./components/AppShell";
import { AuthScreen } from "./components/AuthScreen";
import { AccountAuthScreen } from "./components/AccountAuthScreen";
import { NotificationsPage } from "./pages/NotificationsPage";
import { RunsPage } from "./pages/RunsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { AccountPage } from "./pages/AccountPage";
import { UsersPage } from "./pages/UsersPage";
import { TemplateReviewPage } from "./pages/TemplateReviewPage";
import { AuditPage } from "./pages/AuditPage";
import { AdminRunsPage } from "./pages/AdminRunsPage";
import { ResetPasswordScreen } from "./components/ResetPasswordScreen";
import { OverviewPage } from "./pages/OverviewPage";

const validPages = new Set<PageId>([
  "overview",
  "tasks",
  "templates",
  "runs",
  "notifications",
  "account",
  "users",
  "template-review",
  "admin-runs",
  "audit",
  "settings",
]);

function pageFromHash(): PageId {
  const value = window.location.hash.replace(/^#\/?/, "");
  if (value === "har") return "templates";
  return validPages.has(value as PageId) ? value as PageId : "overview";
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [toast, setToast] = useState("");
  const [taskCreateRequest, setTaskCreateRequest] = useState(0);
  const [taskActionRequest, setTaskActionRequest] = useState<{
    taskId: string;
    action: "manual_login" | "check_proxy" | "edit_task";
    nonce: number;
  }>();

  const loadAuth = () => {
    void api<AuthState>("/api/auth/status")
      .then(setAuth)
      .catch(() =>
        setAuth({
          requiresSetup: false,
          authenticated: false,
          mode: "simulation",
          registrationEnabled: false,
        }),
      );
  };

  useEffect(() => {
    loadAuth();
    const expired = () => setAuth((current) => ({
      requiresSetup: current?.requiresSetup || false,
      authenticated: false,
      mode: current?.mode || "simulation",
      registrationEnabled: current?.registrationEnabled || false,
      registrationMode: current?.registrationMode,
    }));
    const hashChanged = () => setPage(pageFromHash());
    window.addEventListener("auth-expired", expired);
    window.addEventListener("hashchange", hashChanged);
    return () => {
      window.removeEventListener("auth-expired", expired);
      window.removeEventListener("hashchange", hashChanged);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!auth) {
    return <div className="app-loading"><CalendarLoader /></div>;
  }
  if (auth.requiresSetup) {
    return <AuthScreen mode="setup" runtimeMode={auth.mode} onSuccess={loadAuth} />;
  }
  if (!auth.authenticated) {
    return <AccountAuthScreen
      runtimeMode={auth.mode}
      registrationEnabled={auth.registrationEnabled}
      registrationMode={auth.registrationMode}
      onSuccess={loadAuth}
    />;
  }

  const navigate = (nextPage: PageId) => {
    window.location.hash = nextPage;
    setPage(nextPage);
  };
  const logout = async () => {
    await postJson("/api/auth/logout");
    setAuth({
      requiresSetup: false,
      authenticated: false,
      mode: auth.mode,
      registrationEnabled: auth.registrationEnabled,
      registrationMode: auth.registrationMode,
    });
  };
  const notify = (message: string) => setToast(message);
  const allowedPages = new Set<PageId>(["overview", "tasks", "templates", "runs", "notifications", "account"]);
  if (auth.role === "admin") {
    ["users", "template-review", "admin-runs", "audit"].forEach((item) => allowedPages.add(item as PageId));
  }
  const resetMatch = window.location.hash.match(/^#\/?reset-password\/([A-Za-z0-9_-]{43})$/);
  if (resetMatch?.[1]) {
    return <ResetPasswordScreen token={resetMatch[1]} onComplete={() => { window.location.hash = ""; loadAuth(); }} />;
  }
  if (auth.owner) allowedPages.add("settings");
  const activePage = allowedPages.has(page) ? page : "overview";

  return (
    <AppShell
      page={activePage}
      onNavigate={navigate}
      onLogout={logout}
      role={auth.role || "user"}
      displayName={auth.displayName || ""}
      owner={Boolean(auth.owner)}
    >
      {activePage === "overview" ? <OverviewPage
        onNavigate={navigate}
        onAddTask={() => { navigate("tasks"); setTaskCreateRequest((value) => value + 1); }}
        onTaskAction={(taskId, action) => {
          if (action === "view_run") return navigate("runs");
          setTaskActionRequest({ taskId, action, nonce: Date.now() });
          navigate("tasks");
        }}
      /> : null}
      {activePage === "tasks" ? <TasksPage notify={notify} onShowRuns={() => navigate("runs")} capabilities={auth.capabilities!} createRequest={taskCreateRequest} actionRequest={taskActionRequest} onActionHandled={() => setTaskActionRequest(undefined)} /> : null}
      {activePage === "templates" ? <TemplatesPage notify={notify} capabilities={auth.capabilities!} /> : null}
      {activePage === "runs" ? <RunsPage notify={notify} /> : null}
      {activePage === "notifications" ? <NotificationsPage notify={notify} /> : null}
      {activePage === "account" ? <AccountPage notify={notify} role={auth.role || "user"} owner={Boolean(auth.owner)} displayName={auth.displayName || ""} /> : null}
      {activePage === "users" ? <UsersPage notify={notify} owner={Boolean(auth.owner)} /> : null}
      {activePage === "template-review" ? <TemplateReviewPage notify={notify} /> : null}
      {activePage === "admin-runs" ? <AdminRunsPage /> : null}
      {activePage === "audit" ? <AuditPage /> : null}
      {activePage === "settings" ? <SettingsPage notify={notify} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </AppShell>
  );
}

function CalendarLoader() {
  return (
    <div className="loader-mark" aria-label="正在加载">
      <span />
      <span />
      <span />
    </div>
  );
}
