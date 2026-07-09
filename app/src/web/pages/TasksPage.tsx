import {
  CirclePause,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Pencil,
  Play,
  Plus,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  RunListResponse,
  RunJob,
  RunJobEnqueueResponse,
  RunRecord,
  ExecutionTemplate,
  TaskInput,
  TaskSummary,
  UserCapabilities,
} from "../../shared/types";
import { normalizeBrowserFormTemplateConfig } from "../../shared/browser-form";
import { api, postJson, putJson } from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { ManualLoginModal } from "../components/ManualLoginModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatDateTime } from "../utils";

interface TasksPageProps {
  notify: (message: string) => void;
  onShowRuns: () => void;
  capabilities: UserCapabilities;
  createRequest?: number;
  actionRequest?: {
    taskId: string;
    action: "manual_login" | "check_proxy" | "edit_task";
    nonce: number;
  };
  onActionHandled?: () => void;
}

export function TasksPage({ notify, onShowRuns, capabilities, createRequest = 0, actionRequest, onActionHandled }: TasksPageProps) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TaskSummary | null | undefined>();
  const [jobs, setJobs] = useState<Record<string, RunJob>>({});
  const [templates, setTemplates] = useState<ExecutionTemplate[]>([]);
  const [manualTask, setManualTask] = useState<TaskSummary>();

  const load = async () => {
    setLoading(true);
    try {
      const [taskResponse, runResponse, templateResponse] = await Promise.all([
        api<{ items: TaskSummary[] }>("/api/tasks"),
        api<RunListResponse>("/api/runs?pageSize=4"),
        api<{ items: ExecutionTemplate[] }>("/api/templates"),
      ]);
      setTasks(taskResponse.items);
      setJobs(Object.fromEntries(
        taskResponse.items
          .filter((task) => task.activeJob)
          .map((task) => [task.id, task.activeJob!]),
      ));
      setRuns(runResponse.items);
      setTemplates(templateResponse.items);
      return taskResponse.items;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load().then((items) => {
      for (const task of items) {
        if (task.activeJob) void pollJob(task, task.activeJob.id);
      }
    });
  }, []);

  useEffect(() => {
    if (createRequest > 0) setEditing(null);
  }, [createRequest]);

  const runNow = async (task: TaskSummary) => {
    try {
      const response = await postJson<RunRecord | RunJobEnqueueResponse>(
        `/api/tasks/${task.id}/run`,
      );
      if ("created" in response) {
        setJobs((current) => ({ ...current, [task.id]: response }));
        notify(response.created ? `${task.name} 已加入队列` : `${task.name} 已在队列中`);
        await pollJob(task, response.jobId);
      } else {
        notify(`${task.name} 运行完成`);
        await load();
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "运行失败");
    }
  };

  const pollJob = async (task: TaskSummary, jobId: string) => {
    try {
      while (true) {
        const job = await api<RunJob>(`/api/jobs/${jobId}`);
        setJobs((current) => ({ ...current, [task.id]: job }));
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          notify(
            job.status === "succeeded"
              ? `${task.name} 运行完成`
              : job.status === "cancelled"
                ? `${task.name} 已取消排队`
                : `${task.name} 运行失败`,
          );
          await load();
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 800));
      }
    } finally {
      setJobs((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    }
  };

  const cancelJob = async (task: TaskSummary, job: RunJob) => {
    try {
      const cancelled = await postJson<RunJob>(`/api/jobs/${job.id}/cancel`);
      setJobs((current) => ({ ...current, [task.id]: cancelled }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "取消失败");
    }
  };

  const toggleTask = async (task: TaskSummary) => {
    await putJson(`/api/tasks/${task.id}`, taskPayload(task, !task.enabled));
    notify(task.enabled ? "任务已停用" : "任务已启用");
    await load();
  };

  const importCookies = async (task: TaskSummary) => {
    const cookie = window.prompt("粘贴该站点的 Cookie 字符串。内容将加密保存，不会在页面中回显。");
    if (!cookie?.trim()) return;
    try {
      await postJson(`/api/tasks/${task.id}/session/cookies`, { cookie });
      notify(`${task.name} 会话已导入`);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Cookie 导入失败");
    }
  };

  const clearSession = async (task: TaskSummary) => {
    await api<void>(`/api/tasks/${task.id}/session`, { method: "DELETE" });
    notify(`${task.name} 会话已清除`);
    await load();
  };

  const testTaskProxy = async (task: TaskSummary) => {
    try {
      const result = await postJson<{ message: string }>(`/api/tasks/${task.id}/proxy/test`);
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "代理检测失败");
    }
  };

  useEffect(() => {
    if (!actionRequest || !tasks.length) return;
    const task = tasks.find((item) => item.id === actionRequest.taskId);
    if (!task) {
      notify("任务不存在或已不可见");
      onActionHandled?.();
      return;
    }
    if (actionRequest.action === "manual_login") setManualTask(task);
    if (actionRequest.action === "edit_task") setEditing(task);
    if (actionRequest.action === "check_proxy") void testTaskProxy(task);
    onActionHandled?.();
  }, [actionRequest?.nonce, tasks.length]);

  return (
    <div className="page-stack tasks-page">
      <div className="page-heading">
        <div><h1>签到任务</h1></div>
        <button type="button" className="button button-primary" onClick={() => setEditing(null)}>
          <Plus size={21} />添加任务
        </button>
      </div>

      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="data-table task-table">
            <thead>
              <tr>
                <th>站点</th><th>账号</th><th>计划</th><th>最近结果</th><th>下次运行</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <LoadingRows columns={6} /> : tasks.map((task) => {
                const job = jobs[task.id];
                return <tr key={task.id}>
                  <td><strong>{task.name}</strong></td>
                  <td>{task.usernameMasked}{task.sessionStatus ? <div className="muted">会话：{sessionStatusLabel(task.sessionStatus.status)}</div> : null}</td>
                  <td>每天 {task.scheduleTime}</td>
                  <td>{task.latestRun ? <StatusBadge status={task.latestRun.status} /> : <span className="muted">尚未运行</span>}</td>
                  <td>{task.nextRun}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-outline button-small"
                        disabled={!capabilities.runTasksManually || Boolean(job && job.status !== "queued") || !task.enabled}
                        onClick={() => job?.status === "queued" ? void cancelJob(task, job) : void runNow(task)}
                      >
                        <Play size={17} fill="currentColor" />{job ? jobPhaseLabel(job) : "立即运行"}
                      </button>
                      <button type="button" className="button button-neutral button-small" onClick={() => setEditing(task)}>
                        <Pencil size={17} />编辑
                      </button>
                      {capabilities.useManualLogin ? <button type="button" className="button button-neutral button-small" disabled={Boolean(job)} onClick={() => setManualTask(task)}>
                        <UserRoundCheck size={17} />人工登录
                      </button> : null}
                      {capabilities.useManualLogin && task.sessionStatus ? <button type="button" className="button button-neutral button-small" onClick={() => void importCookies(task)}>导入 Cookie</button> : null}
                      {task.sessionStatus?.status !== "none" ? <button type="button" className="button button-neutral button-small" onClick={() => void clearSession(task)}>清除会话</button> : null}
                      {task.proxyMode !== "direct" ? <button type="button" className="button button-neutral button-small" onClick={() => void testTaskProxy(task)}>检测代理</button> : null}
                      <button type="button" disabled={!task.enabled && !capabilities.scheduleTasks} className={`button button-small ${task.enabled ? "button-danger" : "button-neutral"}`} onClick={() => void toggleTask(task)}>
                        <CirclePause size={17} />{task.enabled ? "停用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>;
              })}
              {!loading && tasks.length === 0 ? (
                <tr><td colSpan={6}><div className="empty-state">暂无签到任务，请添加第一个任务。</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel recent-panel">
        <div className="panel-title-row"><h2>最近运行</h2></div>
        <div className="table-scroll">
          <table className="data-table runs-preview-table">
            <thead><tr><th>时间</th><th>站点</th><th>结果</th><th>信息</th></tr></thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.finishedAt)}</td>
                  <td>{run.taskName}</td>
                  <td><StatusBadge status={run.status} /></td>
                  <td>{run.message}</td>
                </tr>
              ))}
              {!loading && runs.length === 0 ? <tr><td colSpan={4}><div className="empty-state">暂无运行记录</div></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="panel-footer-link">
          <button type="button" className="text-link" onClick={onShowRuns}>查看全部运行记录 <span>›</span></button>
        </div>
      </section>

      {editing !== undefined ? (
        <TaskModal
          task={editing}
          templates={templates}
          capabilities={capabilities}
          onClose={() => setEditing(undefined)}
          onSaved={async (message) => {
            setEditing(undefined);
            notify(message);
            await load();
          }}
        />
      ) : null}
      {manualTask ? (
        <ManualLoginModal
          task={manualTask}
          notify={notify}
          onClose={(saved) => {
            setManualTask(undefined);
            if (saved) void load();
          }}
        />
      ) : null}
    </div>
  );
}

function taskPayload(task: TaskSummary, enabled = task.enabled): TaskInput {
  return {
    templateId: task.templateId,
    adapterId: task.adapterId,
    templateUuid: task.templateUuid,
    templateConfig: normalizeBrowserFormTemplateConfig(task.templateConfig),
    name: task.name,
    loginUrl: task.loginUrl,
    checkinUrl: task.checkinUrl,
    scheduleTime: task.scheduleTime,
    timezone: task.timezone,
    notifyServerChan: task.notifyServerChan,
    notifyWechat: task.notifyWechat,
    enabled,
    proxyMode: task.proxyMode,
    proxyServer: task.proxyServer,
    notificationPolicy: task.notificationPolicy,
  };
}

function jobPhaseLabel(job: RunJob): string {
  if (job.status === "cancelled") return "已取消";
  if (job.status === "failed") return "运行失败";
  if (job.status === "succeeded") return "已完成";
  if (job.phase === "queued") return job.nextRetryAt
    ? `等待重试 ${new Date(job.nextRetryAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : "取消排队";
  if (job.phase === "login") return "登录中";
  if (job.phase === "checkin") return "签到中";
  return "通知中";
}

function sessionStatusLabel(status: "none" | "valid" | "expired"): string {
  if (status === "valid") return "有效";
  if (status === "expired") return "已失效";
  return "未创建";
}

function parseTextList(value: string): string[] {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function TaskModal({
  task,
  templates,
  capabilities,
  onClose,
  onSaved,
}: {
  task: TaskSummary | null;
  templates: ExecutionTemplate[];
  capabilities: UserCapabilities;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<TaskInput>(() => task ? taskPayload(task) : {
    templateId: "browser_form",
    adapterId: "browser_form",
    templateUuid: templates.find((template) => template.isPreset && (capabilities.useHttpFlow || template.adapterId !== "http_flow"))?.id,
    templateConfig: normalizeBrowserFormTemplateConfig(undefined),
    name: "",
    loginUrl: "",
    checkinUrl: "",
    username: "",
    password: "",
    scheduleTime: "08:00",
    timezone: "Asia/Shanghai",
    notifyServerChan: true,
    notifyWechat: false,
    enabled: capabilities.scheduleTasks,
    proxyMode: "inherit",
    proxyServer: "",
    proxyUsername: "",
    proxyPassword: "",
    notificationPolicy: { manual: true, scheduled: true, success: true, failure: true, failureThreshold: 1 },
  });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [initialForm] = useState(() => JSON.stringify(form));

  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const updateTemplate = (
    key: keyof TaskInput["templateConfig"],
    value: string | string[],
  ) => {
    setForm((current) => ({
      ...current,
      templateConfig: {
        ...current.templateConfig,
        [key]: value,
      },
    }));
  };
  const updateNotification = (
    key: keyof NonNullable<TaskInput["notificationPolicy"]>,
    value: boolean | number,
  ) => setForm((current) => ({
    ...current,
    notificationPolicy: { ...current.notificationPolicy!, [key]: value },
  }));

  const validateStep = (target: number): boolean => {
    const next: Record<string, string> = {};
    if (target === 0) {
      if (!form.templateUuid) next.templateUuid = "请选择执行模板";
      if (!form.name.trim()) next.name = "请输入任务名称";
      try { new URL(form.loginUrl); } catch { next.loginUrl = "请输入有效的登录地址"; }
      try { new URL(form.checkinUrl); } catch { next.checkinUrl = "请输入有效的签到地址"; }
    }
    if (target === 1) {
      if (!task && !form.username?.trim()) next.username = "请输入登录用户名";
      if (!task && !form.password) next.password = "请输入登录密码";
      if (form.proxyMode === "custom" && !form.proxyServer?.trim()) next.proxyServer = "请输入代理服务器地址";
    }
    if (target === 2) {
      if (!form.scheduleTime) next.scheduleTime = "请选择执行时间";
      if (!form.timezone) next.timezone = "请选择时区";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const nextStep = () => {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(2, current + 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (step < 2) return nextStep();
    if (!validateStep(2)) return;
    setSaving(true);
    try {
      if (task) {
        await putJson("/api/tasks/" + task.id, form);
      } else {
        await postJson("/api/tasks", form);
      }
      await onSaved(
        task
          ? "任务已更新"
          : "任务已保存，可使用立即运行进行验证",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    await api<void>("/api/tasks/" + task.id, { method: "DELETE" });
    await onSaved("任务已删除");
  };

  const requestClose = () => {
    if (JSON.stringify(form) !== initialForm) setConfirmClose(true);
    else onClose();
  };

  const template = form.templateConfig;

  return (
    <Modal title={task ? "编辑签到任务" : "添加签到任务"} onClose={requestClose}>
      <form className="modal-body task-form" onSubmit={submit}>
        <ol className="task-stepper" aria-label="任务配置进度">
          {["目标与模板", "账号与识别", "计划与通知"].map((label, index) => <li key={label} className={index === step ? "active" : index < step ? "complete" : ""}><span>{index < step ? "✓" : index + 1}</span><strong>{label}</strong></li>)}
        </ol>

        {step === 0 ? <section className="wizard-step" aria-labelledby="wizard-target-title">
          <header><h3 id="wizard-target-title">目标与模板</h3><p>选择执行方式并填写目标页面。</p></header>
          <Field label="执行模板" required error={fieldErrors.templateUuid}><select value={form.templateUuid || ""} onChange={(event) => update("templateUuid", event.target.value)}><option value="">请选择模板</option><optgroup label="系统预置与共享模板">{templates.filter((template) => (template.isPreset || template.isShared) && (capabilities.useHttpFlow || template.adapterId !== "http_flow")).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</optgroup><optgroup label="我的模板">{templates.filter((template) => !template.isPreset && !template.isShared && (capabilities.useHttpFlow || template.adapterId !== "http_flow")).map((template) => <option key={template.id} value={template.id}>{template.name}{template.isPrivate ? "（任务专用）" : ""}</option>)}</optgroup></select></Field>
          <Field label="任务名称" required error={fieldErrors.name}><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：社区每日签到" /></Field>
          <Field label="登录地址" required error={fieldErrors.loginUrl}><input type="url" value={form.loginUrl} onChange={(event) => update("loginUrl", event.target.value)} placeholder="https://example.com/login" /></Field>
          <Field label="签到地址" required error={fieldErrors.checkinUrl}><input type="url" value={form.checkinUrl} onChange={(event) => update("checkinUrl", event.target.value)} placeholder="https://example.com/checkin" /></Field>
        </section> : null}

        {step === 1 ? <section className="wizard-step" aria-labelledby="wizard-account-title">
          <header><h3 id="wizard-account-title">账号与识别</h3><p>凭据会加密保存，验证码仅由人工处理。</p></header>
          <Field label="登录用户名" required={!task} error={fieldErrors.username}><input value={form.username || ""} onChange={(event) => update("username", event.target.value)} placeholder={task ? `${task.usernameMasked}（留空保持不变）` : "请输入登录用户名"} /></Field>
          <Field label="登录密码" required={!task} error={fieldErrors.password}><div className="password-field compact-password"><input type={showPassword ? "text" : "password"} value={form.password || ""} onChange={(event) => update("password", event.target.value)} placeholder={task ? "留空保持现有密码" : "请输入登录密码"} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></Field>
          <div className="session-summary"><UserRoundCheck size={20} /><div><strong>会话状态</strong><span>{task ? sessionStatusLabel(task.sessionStatus?.status || "none") : "保存任务后可进行人工登录"}</span></div></div>
          <Field label="代理模式"><select value={form.proxyMode || "inherit"} onChange={(event) => update("proxyMode", event.target.value as TaskInput["proxyMode"])}><option value="inherit">跟随系统</option><option value="direct">直接连接</option>{capabilities.useCustomProxy ? <option value="custom">自定义代理</option> : null}</select></Field>
          {form.proxyMode === "custom" ? <><Field label="代理服务器" required error={fieldErrors.proxyServer}><input value={form.proxyServer || ""} onChange={(event) => update("proxyServer", event.target.value)} placeholder="http://proxy.example.com:8080" /></Field><Field label="代理用户名"><input value={form.proxyUsername || ""} onChange={(event) => update("proxyUsername", event.target.value)} /></Field><Field label="代理密码"><input type="password" value={form.proxyPassword || ""} onChange={(event) => update("proxyPassword", event.target.value)} /></Field></> : null}
          <details className="advanced-template">
          <summary>浏览器识别设置</summary>
          <p>自动识别失败时再填写。多个按钮文字使用 | 分隔。</p>
          <div className="advanced-template-grid">
            <label className="wide"><span>签到入口文字</span><input value={(form.templateConfig.checkinButtonTexts || []).join(" | ")} onChange={(event) => updateTemplate("checkinButtonTexts", parseTextList(event.target.value))} placeholder="签到领奖 | 立即签到" /></label>
            <label><span>账号框 CSS</span><input value={template.usernameSelector || ""} onChange={(event) => updateTemplate("usernameSelector", event.target.value)} /></label>
            <label><span>密码框 CSS</span><input value={template.passwordSelector || ""} onChange={(event) => updateTemplate("passwordSelector", event.target.value)} /></label>
            <label><span>登录按钮 CSS</span><input value={template.loginButtonSelector || ""} onChange={(event) => updateTemplate("loginButtonSelector", event.target.value)} /></label>
            <label><span>登录成功 CSS</span><input value={template.loginSuccessSelector || ""} onChange={(event) => updateTemplate("loginSuccessSelector", event.target.value)} /></label>
            <label className="wide"><span>登录成功 URL 包含</span><input value={template.loginSuccessUrlIncludes || ""} onChange={(event) => updateTemplate("loginSuccessUrlIncludes", event.target.value)} /></label>
            <label><span>签到按钮 CSS</span><input value={template.checkinButtonSelector || ""} onChange={(event) => updateTemplate("checkinButtonSelector", event.target.value)} /></label>
            <label className="wide"><span>登录按钮文字</span><input value={(template.loginButtonTexts || []).join(" | ")} onChange={(event) => updateTemplate("loginButtonTexts", parseTextList(event.target.value))} /></label>
            <label className="wide"><span>成功状态文字</span><input value={(template.successTexts || []).join(" | ")} onChange={(event) => updateTemplate("successTexts", parseTextList(event.target.value))} /></label>
            <label className="wide"><span>已签到状态文字</span><input value={(template.alreadyCheckedTexts || []).join(" | ")} onChange={(event) => updateTemplate("alreadyCheckedTexts", parseTextList(event.target.value))} /></label>
          </div>
        </details>
        </section> : null}

        {step === 2 ? <section className="wizard-step" aria-labelledby="wizard-plan-title">
          <header><h3 id="wizard-plan-title">计划与通知</h3><p>确认执行时间、通知方式和最终配置。</p></header>
          <div className="wizard-grid"><Field label="执行时间" required error={fieldErrors.scheduleTime}><input type="time" value={form.scheduleTime} onChange={(event) => update("scheduleTime", event.target.value)} /></Field><Field label="时区" required error={fieldErrors.timezone}><select value={form.timezone} onChange={(event) => update("timezone", event.target.value)}><option>Asia/Shanghai</option><option>Asia/Hong_Kong</option><option>UTC</option></select></Field></div>
          <Field label="启用任务"><label className="switch"><input type="checkbox" disabled={!capabilities.scheduleTasks} checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span /></label></Field>
          <Field label="通知渠道"><div className="checkbox-row"><label><input type="checkbox" checked={form.notifyServerChan} onChange={(event) => update("notifyServerChan", event.target.checked)} />Server酱</label><label><input type="checkbox" checked={form.notifyWechat} onChange={(event) => update("notifyWechat", event.target.checked)} />企业微信群机器人</label></div></Field>
          <Field label="通知时机"><div className="checkbox-row"><label><input type="checkbox" checked={form.notificationPolicy?.manual} onChange={(event) => updateNotification("manual", event.target.checked)} />手动执行</label><label><input type="checkbox" checked={form.notificationPolicy?.scheduled} onChange={(event) => updateNotification("scheduled", event.target.checked)} />定时执行</label><label><input type="checkbox" checked={form.notificationPolicy?.success} onChange={(event) => updateNotification("success", event.target.checked)} />成功</label><label><input type="checkbox" checked={form.notificationPolicy?.failure} onChange={(event) => updateNotification("failure", event.target.checked)} />失败</label></div></Field>
          <div className="task-review"><h4>配置摘要</h4><dl><div><dt>任务</dt><dd>{form.name || "未填写"}</dd></div><div><dt>模板</dt><dd>{templates.find((item) => item.id === form.templateUuid)?.name || "未选择"}</dd></div><div><dt>计划</dt><dd>{form.enabled ? `每天 ${form.scheduleTime}（${form.timezone}）` : "已停用"}</dd></div><div><dt>代理</dt><dd>{form.proxyMode === "direct" ? "直接连接" : form.proxyMode === "custom" ? "自定义代理" : "跟随系统"}</dd></div></dl></div>
          <div className="inline-info">保存不会立即访问网站。请在任务列表中单独运行验证。</div>
        </section> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <footer className="modal-footer">
          {task ? <button type="button" className="button button-danger ghost-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={18} />删除任务</button> : <span />}
          <div className="modal-footer-actions">
            <button type="button" className="button button-neutral" onClick={requestClose}>取消</button>
            {step > 0 ? <button type="button" className="button button-outline" onClick={() => { setFieldErrors({}); setStep((current) => current - 1); }}><ChevronLeft size={18} />上一步</button> : null}
            {step < 2 ? <button type="submit" className="button button-primary">下一步<ChevronRight size={18} /></button> : <button type="submit" className="button button-primary" disabled={saving}>{saving ? "保存中…" : "保存任务"}</button>}
          </div>
        </footer>
      </form>
      {confirmClose ? <ConfirmDialog title="放弃未保存的修改？" message="关闭后，本次填写的内容不会保留。" confirmLabel="放弃修改" danger onCancel={() => setConfirmClose(false)} onConfirm={onClose} /> : null}
      {confirmDelete ? <ConfirmDialog title="删除签到任务？" message={`将删除“${task?.name || ""}”，历史运行记录会保留。`} confirmLabel="删除任务" danger onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} /> : null}
    </Modal>
  );
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="form-row"><span className="form-row-label">{label}{required ? <b>*</b> : null}</span><span className="form-row-control">{children}</span></label>;
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return <label className="wizard-field"><span>{label}{required ? <b>*</b> : null}</span>{children}{error ? <small className="field-error">{error}</small> : null}</label>;
}

function LoadingRows({ columns }: { columns: number }) {
  return <>{[0, 1].map((row) => <tr key={row}>{Array.from({ length: columns }, (_, cell) => <td key={cell}><span className="skeleton" /></td>)}</tr>)}</>;
}
