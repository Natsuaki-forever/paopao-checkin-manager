import {
  Activity,
  Bell,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Gauge,
  LayoutTemplate,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { APP_VERSION } from "../../shared/version";
import { ThemeToggle } from "./ThemeToggle";

export type PageId = "overview" | "tasks" | "templates" | "runs" | "notifications" | "account" |
  "users" | "template-review" | "admin-runs" | "audit" | "settings";

const dailyNavigation = [
  { id: "overview" as const, label: "运行总览", icon: Gauge },
  { id: "tasks" as const, label: "签到任务", icon: CalendarCheck },
  { id: "templates" as const, label: "执行模板", icon: LayoutTemplate },
  { id: "runs" as const, label: "运行记录", icon: Clock3 },
  { id: "notifications" as const, label: "通知设置", icon: Bell },
];
const adminNavigation = [
  { id: "users" as const, label: "用户管理", icon: Users },
  { id: "template-review" as const, label: "模板审核", icon: ClipboardCheck },
  { id: "admin-runs" as const, label: "全站运行", icon: Activity },
  { id: "audit" as const, label: "审计日志", icon: ScrollText },
];

interface AppShellProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
  children: ReactNode;
  role: "user" | "admin";
  displayName: string;
  owner: boolean;
}

export function AppShell({
  page,
  onNavigate,
  onLogout,
  role,
  displayName,
  owner,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = (nextPage: PageId) => {
    onNavigate(nextPage);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <CalendarDays size={27} aria-hidden="true" />
          <span>炮炮签到站</span>
          <button type="button" className="icon-button sidebar-close" aria-label="关闭菜单" onClick={() => setMobileOpen(false)}>
            <X size={21} />
          </button>
        </div>
        <nav aria-label="主导航">
          <NavigationGroup label="日常工作" items={dailyNavigation} page={page} onNavigate={navigate} />
          {role === "admin" ? <NavigationGroup
            label="管理中心"
            items={[
              ...adminNavigation,
              ...(owner ? [{ id: "settings" as const, label: "系统设置", icon: Settings }] : []),
            ]}
            page={page}
            onNavigate={navigate}
          /> : null}
        </nav>
        <div className="sidebar-footer">
          <span>v{APP_VERSION}</span>
          <small>构建于 2026-07-08</small>
        </div>
      </aside>
      {mobileOpen ? <button type="button" className="sidebar-scrim" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} /> : null}
      <div className="app-main">
        <header className="topbar">
          <button type="button" className="icon-button menu-button" aria-label="打开菜单" onClick={() => setMobileOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="mobile-brand"><CalendarDays size={22} /><span>炮炮签到站</span></div>
          <div className="topbar-spacer" />
          <ThemeToggle />
          <details className="account-menu">
            <summary aria-label="账户菜单">
              <span className="account-avatar"><UserRound size={19} /></span>
              <span className="account-copy"><strong>{displayName || "用户"}</strong><small>{owner ? "主管理员" : role === "admin" ? "运营管理员" : "普通用户"}</small></span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="account-popover">
              <button type="button" onClick={() => navigate("account")}><UserRound size={18} />我的账户</button>
              <button type="button" onClick={onLogout}><LogOut size={18} />退出登录</button>
            </div>
          </details>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

function NavigationGroup({
  label,
  items,
  page,
  onNavigate,
}: {
  label: string;
  items: ReadonlyArray<{ id: PageId; label: string; icon: typeof Gauge }>;
  page: PageId;
  onNavigate: (page: PageId) => void;
}) {
  return <section className="nav-group">
    <h2>{label}</h2>
    <div>
      {items.map((item) => {
        const Icon = item.icon;
        return <button
          key={item.id}
          type="button"
          className={`nav-item ${page === item.id ? "nav-item-active" : ""}`}
          aria-current={page === item.id ? "page" : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <Icon size={20} aria-hidden="true" />
          <span>{item.label}</span>
        </button>;
      })}
    </div>
  </section>;
}
