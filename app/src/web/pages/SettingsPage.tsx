import {
  CheckCircle2,
  CircleAlert,
  Database,
  KeyRound,
  Network,
  Save,
  ServerCog,
  TimerReset,
  HardDrive,
  UserPlus,
  Copy,
  Trash2,
  ExternalLink,
  Info,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ServiceStatus, StorageUsage, SystemSettings, UserCapabilities, UserQuotas } from "../../shared/types";
import { api, deleteJson, postJson, putJson } from "../api";
import { formatDateTime } from "../utils";
import { PigTankEasterEgg } from "../components/PigTankEasterEgg";
import { useEasterEggSequence } from "../hooks/useEasterEggSequence";
import { APP_VERSION } from "../../shared/version";

export function SettingsPage({ notify }: { notify: (message: string) => void }) {
  const [settings, setSettings] = useState<SystemSettings>();
  const [status, setStatus] = useState<ServiceStatus>();
  const [storage, setStorage] = useState<StorageUsage>();
  const [saving, setSaving] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);
  const [registration, setRegistration] = useState<RegistrationConfig>();
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [activeTab, setActiveTab] = useState<"execution" | "storage" | "proxy" | "registration" | "status" | "about">("execution");
  const versionPig = useEasterEggSequence({ clicks: 5, windowMs: 3_000 });

  const load = async () => {
    const [settingsResponse, statusResponse, storageResponse, registrationResponse, inviteResponse] = await Promise.all([
      api<SystemSettings>("/api/settings"),
      api<ServiceStatus>("/api/settings/status"),
      api<StorageUsage>("/api/settings/storage"),
      api<RegistrationConfig>("/api/admin/registration"),
      api<{ items: InviteSummary[] }>("/api/admin/invites"),
    ]);
    setSettings(settingsResponse);
    setStatus(statusResponse);
    setStorage(storageResponse);
    setRegistration(registrationResponse);
    setInvites(inviteResponse.items);
  };
  useEffect(() => { void load(); }, []);

  const update = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) =>
    setSettings((current) => current ? { ...current, [key]: value } : current);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await putJson<SystemSettings>("/api/settings", settings);
      await load();
      notify("系统设置已保存");
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const testProxy = async () => {
    if (!settings) return;
    setTestingProxy(true);
    try {
      setSettings(await putJson<SystemSettings>("/api/settings", settings));
      const result = await postJson<{ message: string }>("/api/settings/proxy/test");
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "代理检测失败");
    } finally {
      await load();
      setTestingProxy(false);
    }
  };

  const saveRegistration = async () => {
    if (!registration) return;
    try {
      await putJson("/api/admin/registration", {
        mode: registration.configuredMode,
        defaultCapabilities: registration.defaultCapabilities,
        defaultQuotas: registration.defaultQuotas,
      });
      await load();
      notify("注册策略和新用户默认权限已保存");
    } catch (error) { notify(error instanceof Error ? error.message : "注册设置保存失败"); }
  };

  const createInvite = async () => {
    try {
      const result = await postJson<InviteSummary & { code: string }>("/api/admin/invites", {
        label: inviteLabel,
        maxUses: inviteMaxUses,
      });
      setInviteLabel("");
      await load();
      await navigator.clipboard.writeText(result.code).catch(() => undefined);
      notify("邀请码已生成并复制");
    } catch (error) { notify(error instanceof Error ? error.message : "邀请码创建失败"); }
  };

  const copyInvite = async (code: string) => {
    await navigator.clipboard.writeText(code);
    notify("邀请码已复制");
  };

  const deleteInvite = async (id: string) => {
    try {
      await deleteJson(`/api/admin/invites/${id}`);
      await load();
      notify("邀请码已删除");
    } catch (error) { notify(error instanceof Error ? error.message : "删除邀请码失败"); }
  };

  if (!settings || !status || !storage) return <div className="empty-state">正在加载系统设置…</div>;
  return (
    <div className="page-stack">
      <div className="page-heading"><div><h1>系统设置</h1><p className="page-subtitle">管理执行、安全与服务配置。</p></div></div>
      <nav className="settings-tabs" aria-label="系统设置分类">
        {([
          ["execution", "执行"],
          ["storage", "存储与会话"],
          ["proxy", "代理"],
          ["registration", "注册与默认权限"],
          ["status", "服务状态"],
          ["about", "关于本项目"],
        ] as const).map(([id, label]) => <button key={id} type="button" className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>{label}</button>)}
      </nav>

      {activeTab === "execution" ? <section className="panel settings-section">
        <div className="settings-section-title"><TimerReset size={22} /><div><h2>执行设置</h2><p>后续接入真实适配器时使用的全局默认值。</p></div></div>
        <div className="settings-grid">
          <NumberField label="页面导航超时" value={settings.navigationTimeoutMs / 1000} min={1} max={300} onChange={(value) => update("navigationTimeoutMs", value * 1000)} suffix="秒" />
          <NumberField label="页面操作超时" value={settings.actionTimeoutMs / 1000} min={1} max={300} onChange={(value) => update("actionTimeoutMs", value * 1000)} suffix="秒" />
        </div>
        <div className="settings-save-row"><span>修改仅影响后续执行。</span><button type="button" className="button button-primary" onClick={() => void save()} disabled={saving}><Save size={18} />{saving ? "保存中…" : "保存执行设置"}</button></div>
      </section> : null}

      {activeTab === "storage" ? <section className="panel settings-section">
        <div className="settings-section-title"><Database size={22} /><div><h2>存储与会话</h2><p>截图同时受保留天数和容量上限约束，任一先到即从最旧内容开始清理。</p></div></div>
        <div className="settings-grid">
          <NumberField label="运行记录保留" value={settings.retentionDays} min={1} max={365} onChange={(value) => update("retentionDays", value)} suffix="天" />
          <NumberField label="失败截图容量上限" value={settings.screenshotMaxMb} min={10} max={10000} onChange={(value) => update("screenshotMaxMb", value)} suffix="MB" />
          <NumberField label="登录会话有效期" value={settings.sessionHours} min={1} max={168} onChange={(value) => update("sessionHours", value)} suffix="小时" />
          <NumberField label="审计日志保留" value={settings.auditRetentionDays} min={30} max={365} onChange={(value) => update("auditRetentionDays", value)} suffix="天" />
        </div>
        <StorageMeter storage={storage} />
        <div className="settings-save-row"><span>保存后会按新规则执行一次安全清理。</span><button type="button" className="button button-primary" onClick={() => void save()} disabled={saving}><Save size={18} />{saving ? "保存中…" : "保存存储设置"}</button></div>
      </section> : null}

      {activeTab === "proxy" ? <section className="panel settings-section">
        <div className="settings-section-title"><Network size={22} /><div><h2>代理设置</h2><p>检测时将通过代理连接一个已启用任务的目标签到站点。</p></div></div>
        <div className="proxy-row"><label><span>代理服务器</span><input value={settings.proxyServer} onChange={(event) => update("proxyServer", event.target.value)} placeholder="例如 http://mihomo:7890" /></label><button type="button" className="button button-outline" onClick={() => void testProxy()} disabled={testingProxy}>{testingProxy ? "检测中…" : "保存并检测"}</button></div>
        <div className={`proxy-test-note proxy-test-${status.proxy}`}>
          {status.proxy === "configured_tested" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
          <span>{proxyStatusText(status)}</span>
        </div>
      </section> : null}

      {activeTab === "registration" && registration ? <section className="panel settings-section registration-section">
        <div className="settings-section-title"><UserPlus size={22} /><div><h2>注册与默认权限</h2><p>正式环境建议使用邀请码注册；部署环境总开关关闭时不能开放注册。</p></div></div>
        {!registration.environmentEnabled ? <div className="form-error">部署环境已关闭注册，只能保持关闭状态。</div> : null}
        <label className="number-field"><span>注册方式</span><select value={registration.configuredMode} onChange={(event) => setRegistration({ ...registration, configuredMode: event.target.value as RegistrationConfig["configuredMode"] })}><option value="closed">关闭注册</option><option value="invite">邀请码注册</option><option value="public">公开注册</option></select></label>
        <h3 className="registration-subheading">新用户默认能力</h3>
        <div className="permission-grid">{(Object.keys(registration.defaultCapabilities) as Array<keyof UserCapabilities>).map((key) => <label className="check-row" key={key}><input type="checkbox" checked={registration.defaultCapabilities[key]} onChange={(event) => setRegistration({ ...registration, defaultCapabilities: { ...registration.defaultCapabilities, [key]: event.target.checked } })} /><span>{registrationCapabilityLabel(key)}</span></label>)}</div>
        <div className="settings-grid"><NumberField label="任务上限" value={registration.defaultQuotas.maxTasks} min={0} max={1000} onChange={(value) => setRegistration({ ...registration, defaultQuotas: { ...registration.defaultQuotas, maxTasks: value } })} suffix="项" /><NumberField label="启用计划上限" value={registration.defaultQuotas.maxEnabledTasks} min={0} max={1000} onChange={(value) => setRegistration({ ...registration, defaultQuotas: { ...registration.defaultQuotas, maxEnabledTasks: value } })} suffix="项" /><NumberField label="每日操作上限" value={registration.defaultQuotas.maxDailyActions} min={0} max={10000} onChange={(value) => setRegistration({ ...registration, defaultQuotas: { ...registration.defaultQuotas, maxDailyActions: value } })} suffix="次" /></div>
        <button className="button button-primary" onClick={() => void saveRegistration()}>保存注册策略</button>
        <div className="settings-divider" />
        <h3 className="invite-subheading">邀请码</h3>
        <div className="invite-create-row"><label><span>备注</span><input value={inviteLabel} onChange={(event) => setInviteLabel(event.target.value)} placeholder="例如：家庭成员" /></label><label><span>复用次数</span><select value={inviteMaxUses} onChange={(event) => setInviteMaxUses(Number(event.target.value))}><option value={1}>1 次</option><option value={2}>2 次</option><option value={5}>5 次</option><option value={10}>10 次</option><option value={20}>20 次</option><option value={50}>50 次</option></select></label><button className="button button-outline" onClick={() => void createInvite()}>生成邀请码</button></div>
        <div className="compact-list invite-list">{invites.map((invite) => <div className="invite-list-item" key={invite.id}><span><strong>{invite.label || "未命名邀请码"}</strong><small>{invite.usedCount}/{invite.maxUses} 次 · {invite.disabledAt ? "已停用" : "可用"} · {invite.code || "旧邀请码，请重新生成"}</small></span><span className="invite-actions"><button type="button" className="icon-button" aria-label="复制邀请码" title="复制邀请码" disabled={!invite.code} onClick={() => invite.code ? void copyInvite(invite.code) : undefined}><Copy size={17} /></button><button type="button" className="icon-button icon-button-danger" aria-label="删除邀请码" title="删除邀请码" onClick={() => void deleteInvite(invite.id)}><Trash2 size={17} /></button></span></div>)}</div>
      </section> : null}

      {activeTab === "status" ? <section className="panel settings-section">
        <div className="settings-section-title"><ServerCog size={22} /><div><h2>服务状态</h2><p>只读状态，用于确认当前运行环境。</p></div></div>
        <div className="status-grid"><StatusItem icon={<CheckCircle2 />} label="运行模式" value={status.mode === "production" ? "正式运行" : "本地模拟"} tone="blue" /><StatusItem icon={<Database />} label="数据库" value="已连接" /><StatusItem icon={<TimerReset />} label="队列" value={status.features.queue ? "已开启" : "已关闭"} /><StatusItem icon={<KeyRound />} label="会话复用" value={status.features.session ? "已开启" : "已关闭"} /><StatusItem icon={<Network />} label="HTTP Flow" value={status.features.httpFlow ? "已开启" : "已关闭"} tone="muted" /><StatusItem icon={status.proxy === "configured_failed" ? <CircleAlert /> : <Network />} label="代理" value={proxyStatusLabel(status.proxy)} tone={status.proxy === "configured_tested" ? "green" : status.proxy === "configured_failed" ? "danger" : "muted"} /><StatusItem icon={<ServerCog />} label="版本" value={status.version} tone="muted" onActivate={versionPig.trigger} /><StatusItem icon={<CheckCircle2 />} label="启动时间" value={formatDateTime(status.startedAt)} tone="muted" /></div>
        {versionPig.visible ? <PigTankEasterEgg variant="wiggle" /> : null}
      </section> : null}

      {activeTab === "about" ? <section className="panel settings-section about-section">
        <div className="settings-section-title"><Info size={22} /><div><h2>关于本项目</h2><p>了解炮炮签到站、项目归属与安全使用边界。</p></div></div>
        <div className="about-hero"><div className="about-mark"><img src="/favicon-transparent.png" alt="炮炮签到站" /></div><div><strong>炮炮签到站</strong><span>Paopao Checkin Manager</span><p>面向个人及授权用户的网页任务管理工具，用于管理网站签到任务、执行计划、账号会话与运行记录。</p></div></div>
        <div className="about-grid"><div className="about-fact"><small>当前版本</small><strong>{APP_VERSION}</strong></div><div className="about-fact"><small>运行模式</small><strong>{status.mode === "production" ? "Production" : "Simulation"}</strong></div><div className="about-fact"><small>数据存储</small><strong>SQLite</strong></div><div className="about-fact"><small>执行引擎</small><strong>Playwright</strong></div></div>
        <div className="about-notice"><ShieldCheck size={19} /><div><strong>安全使用声明</strong><p>本系统仅用于用户本人或已获得明确授权的网站与账户。验证码仅支持人工处理，系统不会自动破解验证码、绕过访问控制或规避目标网站的安全机制。使用本系统时，请遵守目标网站的服务条款及相关法律法规。</p></div></div>
        <div className="about-links"><div className="maintainer"><img src="https://github.com/Natsuaki-forever.png?size=80" alt="NatsuAki 头像" /><span><small>项目维护者</small><strong>NatsuAki</strong></span></div><a className="button button-outline" href="https://github.com/Natsuaki-forever/paopao-checkin-manager" target="_blank" rel="noreferrer"><ExternalLink size={17} />项目主页</a><a className="button button-outline" href="https://github.com/Natsuaki-forever/paopao-checkin-manager/issues" target="_blank" rel="noreferrer"><ExternalLink size={17} />问题反馈</a></div>
        <div className="about-copyright">© 2026 NatsuAki Works. All rights reserved.</div>
      </section> : null}
    </div>
  );
}

interface RegistrationConfig {
  environmentEnabled: boolean;
  mode: "closed" | "invite" | "public";
  configuredMode: "closed" | "invite" | "public";
  defaultCapabilities: UserCapabilities;
  defaultQuotas: UserQuotas;
}

interface InviteSummary {
  id: string;
  code?: string;
  label: string;
  maxUses: number;
  usedCount: number;
  expiresAt?: string;
  disabledAt?: string;
  createdAt: string;
}

function registrationCapabilityLabel(key: keyof UserCapabilities): string {
  return ({ scheduleTasks: "定时执行", runTasksManually: "手动执行", useManualLogin: "人工登录", importHar: "HAR 导入", useHttpFlow: "HTTP Flow", useCustomProxy: "自定义代理", submitSharedTemplates: "模板投稿" })[key];
}

function StorageMeter({ storage }: { storage: StorageUsage }) {
  const percent = storage.screenshotMaxBytes > 0
    ? Math.min(100, storage.screenshotBytes / storage.screenshotMaxBytes * 100)
    : 0;
  return <div className="storage-meter">
    <div className="storage-meter-heading"><span><HardDrive size={17} />当前可管理存储</span><strong>{formatBytes(storage.managedBytes)}</strong></div>
    <div className="storage-bar" aria-label={`截图容量使用 ${percent.toFixed(1)}%`}><span style={{ width: `${percent}%` }} /></div>
    <div className="storage-facts">
      <span>失败截图 {storage.screenshotCount} 张 · {formatBytes(storage.screenshotBytes)} / {formatBytes(storage.screenshotMaxBytes)}</span>
      <span>数据库 {formatBytes(storage.databaseBytes)}</span>
      <span>运行记录 {storage.runRecords} 条</span>
      <span>已完成队列记录 {storage.completedJobs} 条</span>
    </div>
    <p>自动清理范围：过期运行记录、已完成队列记录、失败截图、遗留截图和已失效人工会话令牌。任务、密钥、有效登录会话和备份不会自动删除。</p>
  </div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function NumberField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="number-field"><span>{label}</span><div><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} /><b>{suffix}</b></div></label>;
}

function proxyStatusLabel(proxy: ServiceStatus["proxy"]): string {
  if (proxy === "not_configured") return "未配置";
  if (proxy === "configured_tested") return "检测通过";
  if (proxy === "configured_failed") return "检测失败";
  return "已配置 · 待检测";
}

function proxyStatusText(status: ServiceStatus): string {
  if (status.proxy === "not_configured") return "填写代理地址后点击“保存并检测”。";
  if (status.proxy === "configured_not_tested") return "代理已保存，但尚未连接目标签到站点进行检测。";
  const time = status.proxyTestedAt ? ` · ${formatDateTime(status.proxyTestedAt)}` : "";
  return `${status.proxyTestMessage || proxyStatusLabel(status.proxy)}${time}`;
}

function StatusItem({ icon, label, value, tone = "green", onActivate }: { icon: React.ReactNode; label: string; value: string; tone?: "green" | "blue" | "muted" | "danger"; onActivate?: () => void }) {
  return <div className="status-item"><span className={`status-item-icon status-item-${tone}`}>{icon}</span><div><small>{label}</small>{onActivate ? <button type="button" className="secret-value" onClick={onActivate}>{value}</button> : <strong>{value}</strong>}</div></div>;
}
