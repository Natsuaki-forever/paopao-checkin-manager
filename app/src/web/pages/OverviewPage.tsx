import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  KeyRound,
  LayoutTemplate,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardAttentionItem, DashboardResponse, TaskSummary } from "../../shared/types";
import { api } from "../api";
import type { PageId } from "../components/AppShell";
import { PigTankEasterEgg } from "../components/PigTankEasterEgg";
import { useEasterEggSequence } from "../hooks/useEasterEggSequence";

export function OverviewPage({
  onNavigate,
  onAddTask,
  onTaskAction,
}: {
  onNavigate: (page: PageId) => void;
  onAddTask: () => void;
  onTaskAction: (taskId: string, action: DashboardAttentionItem["action"]) => void;
}) {
  const [dashboard, setDashboard] = useState<DashboardResponse>();
  const [error, setError] = useState("");
  const healthPig = useEasterEggSequence({ clicks: 5, windowMs: 3_000, enabled: Boolean(dashboard && dashboard.attention.length === 0) });
  const load = () => {
    setError("");
    void api<DashboardResponse>("/api/dashboard").then(setDashboard).catch((reason) =>
      setError(reason instanceof Error ? reason.message : "总览加载失败"));
  };
  useEffect(load, []);

  if (error) return <section className="overview-error" role="alert"><AlertTriangle size={22} /><div><strong>总览加载失败</strong><p>{error}</p></div><button className="button button-outline" onClick={load}><RefreshCw size={17} />重试</button></section>;
  if (!dashboard) return <OverviewSkeleton />;
  const nextTask = dashboard.tasks.find((task) => task.nextRunAt === dashboard.summary.nextRunAt);

  return <div className="page-stack overview-page">
    <div className="page-heading overview-heading">
      <div><h1>运行总览</h1><p className="page-subtitle">查看今天的计划、异常和登录会话。</p></div>
      <button className="button button-primary" onClick={onAddTask}><Plus size={19} />添加任务</button>
    </div>

    <section className="status-rail" aria-label="今日运行状态">
      <Metric icon={<CalendarClock />} label="今日计划" value={dashboard.summary.todayPlanned} />
      <Metric icon={<CheckCircle2 />} label="已完成" value={dashboard.summary.todayCompleted} tone="success" />
      <Metric icon={<AlertTriangle />} label="需要处理" value={dashboard.summary.attentionCount} tone={dashboard.summary.attentionCount ? "warning" : "success"} />
      <Metric icon={<Clock3 />} label="下次执行" value={nextTask?.nextRun || "暂无计划"} wide />
      <Metric icon={<UserRoundCheck />} label="有效会话" value={dashboard.summary.validSessionCount} tone="cyan" />
    </section>

    <section className="attention-section">
      <div className="section-title-row"><h2>需要处理</h2><span>{dashboard.attention.length}</span></div>
      {dashboard.attention.length ? <div className="attention-list">{dashboard.attention.map((item) =>
        <AttentionRow key={item.taskId} item={item} onTaskAction={onTaskAction} />)}</div>
        : <div className="healthy-empty"><button className="secret-trigger" type="button" aria-label="健康状态" onClick={healthPig.trigger}><ShieldCheck size={21} /></button><div><strong>运行状态正常</strong><p>当前没有需要人工处理的事项。</p></div>{healthPig.visible ? <PigTankEasterEgg variant="drive" /> : null}</div>}
    </section>

    <section className="data-section">
      <div className="section-title-row"><h2>当前任务</h2><button className="text-link" onClick={() => onNavigate("tasks")}>管理任务<ChevronRight size={16} /></button></div>
      {dashboard.tasks.length ? <TaskTable tasks={dashboard.tasks} onNavigate={onNavigate} />
        : <div className="empty-state"><CircleGauge size={28} /><strong>还没有签到任务</strong><p>添加第一个任务后，这里会显示运行计划。</p><button className="button button-primary" onClick={onAddTask}><Plus size={18} />添加任务</button></div>}
    </section>

    {dashboard.admin ? <section className="admin-summary" aria-label="管理员摘要">
      <SummaryItem icon={<Users />} label="活跃用户" value={dashboard.admin.activeUsers} />
      <SummaryItem icon={<LayoutTemplate />} label="待审核模板" value={dashboard.admin.pendingTemplateSubmissions} tone="warning" />
      <SummaryItem icon={<AlertTriangle />} label="24 小时失败" value={dashboard.admin.failures24h} tone="danger" />
    </section> : null}
  </div>;
}

function Metric({ icon, label, value, tone = "blue", wide = false }: { icon: React.ReactNode; label: string; value: string | number; tone?: "blue" | "success" | "warning" | "cyan"; wide?: boolean }) {
  return <div className={`metric metric-${tone} ${wide ? "metric-wide" : ""}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function AttentionRow({ item, onTaskAction }: { item: DashboardAttentionItem; onTaskAction: (taskId: string, action: DashboardAttentionItem["action"]) => void }) {
  const action = item.action === "view_run" ? "查看详情" : item.action === "check_proxy" ? "检查代理" : item.action === "edit_task" ? "编辑识别" : "人工登录";
  return <article className={`attention-row attention-${item.severity}`}>
    <AlertTriangle size={20} />
    <div><strong>{item.taskName}</strong><p>{item.message}</p></div>
    <button className="button button-danger button-small" onClick={() => onTaskAction(item.taskId, item.action)}>{action}</button>
  </article>;
}

function TaskTable({ tasks, onNavigate }: { tasks: TaskSummary[]; onNavigate: (page: PageId) => void }) {
  return <div className="responsive-task-table">
    <div className="responsive-table-head"><span>任务</span><span>状态</span><span>下次执行</span><span>会话</span><span>操作</span></div>
    {tasks.map((task) => <article className="responsive-task-row" key={task.id}>
      <div className="task-identity"><span className="task-icon"><CalendarClock size={18} /></span><strong>{task.name}</strong></div>
      <div data-label="状态"><StatusText task={task} /></div>
      <div data-label="下次执行" className="numeric">{task.nextRun}</div>
      <div data-label="会话"><span className={`session-state session-${task.sessionStatus?.status || "none"}`}>{task.sessionStatus?.status === "valid" ? "有效" : task.sessionStatus?.status === "expired" ? "已失效" : "未建立"}</span></div>
      <div data-label="操作"><button className="text-link" onClick={() => onNavigate("tasks")}><Play size={15} />管理</button></div>
    </article>)}
  </div>;
}

function StatusText({ task }: { task: TaskSummary }) {
  if (task.activeJob?.status === "running") return <span className="run-state run-running">运行中</span>;
  if (task.activeJob?.status === "queued") return <span className="run-state run-queued">排队中</span>;
  if (!task.enabled) return <span className="run-state run-muted">已停用</span>;
  if (task.latestRun?.status === "success" || task.latestRun?.status === "already_checked") return <span className="run-state run-success">正常</span>;
  if (task.latestRun) return <span className="run-state run-danger">需处理</span>;
  return <span className="run-state run-muted">等待执行</span>;
}

function SummaryItem({ icon, label, value, tone = "blue" }: { icon: React.ReactNode; label: string; value: number; tone?: "blue" | "warning" | "danger" }) {
  return <div className={`summary-item summary-${tone}`}><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>;
}

function OverviewSkeleton() {
  return <div className="page-stack overview-page" aria-label="正在加载运行总览"><div className="page-heading"><span className="skeleton skeleton-heading" /></div><div className="status-rail skeleton-block" /><div className="data-section skeleton-block" /></div>;
}
