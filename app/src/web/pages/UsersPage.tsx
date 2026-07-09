import { KeyRound, RefreshCw, Shield, UserRoundCog, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import type { AdminUserSummary, UserCapabilities } from "../../shared/types";
import { api, deleteJson, patchJson, postJson, putJson } from "../api";
import { Modal } from "../components/Modal";
import { formatDateTime } from "../utils";

const capabilityLabels: Record<keyof UserCapabilities, string> = {
  scheduleTasks: "允许定时执行",
  runTasksManually: "允许手动执行",
  useManualLogin: "允许人工登录",
  importHar: "允许导入 HAR",
  useHttpFlow: "允许 HTTP Flow",
  useCustomProxy: "允许自定义代理",
  submitSharedTemplates: "允许提交共享模板",
};

export function UsersPage({ owner, notify }: { owner: boolean; notify: (message: string) => void }) {
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [selected, setSelected] = useState<AdminUserSummary>();
  const [draft, setDraft] = useState<AdminUserSummary>();
  const [resetPath, setResetPath] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const load = async () => setItems((await api<{ items: AdminUserSummary[] }>("/api/admin/users")).items);
  useEffect(() => { void load(); }, []);
  const open = (user: AdminUserSummary) => {
    setSelected(user);
    setDraft(structuredClone(user));
    setResetPath("");
    setDeleteConfirmation("");
  };
  const save = async () => {
    if (!draft) return;
    try {
      const updated = await patchJson<AdminUserSummary>(`/api/admin/users/${draft.id}`, {
        status: draft.status,
        capabilities: draft.capabilities,
        quotas: draft.quotas,
      });
      setSelected(updated); setDraft(structuredClone(updated)); await load(); notify("用户权限已保存");
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败"); }
  };
  const action = async (kind: "revoke" | "reset" | "role") => {
    if (!draft) return;
    try {
      if (kind === "revoke") {
        await postJson(`/api/admin/users/${draft.id}/revoke-sessions`);
        notify("已强制退出该用户");
      } else if (kind === "reset") {
        const result = await postJson<{ resetPath: string }>(`/api/admin/users/${draft.id}/password-reset`);
        setResetPath(result.resetPath);
      } else {
        const updated = await putJson<AdminUserSummary>(`/api/admin/users/${draft.id}/role`, {
          role: draft.role === "admin" ? "user" : "admin",
        });
        setSelected(updated); setDraft(structuredClone(updated)); await load();
      }
    } catch (error) { notify(error instanceof Error ? error.message : "操作失败"); }
  };
  const remove = async () => {
    if (!draft || deleteConfirmation !== draft.username) return notify("请输入完整用户名确认删除");
    try {
      await deleteJson(`/api/admin/users/${draft.id}`, { confirmUsername: deleteConfirmation });
      setSelected(undefined); setDraft(undefined); await load(); notify("用户及其数据已永久删除");
    } catch (error) { notify(error instanceof Error ? error.message : "删除失败"); }
  };
  return <div className="page-stack">
    <div className="page-heading"><div><h1>用户管理</h1><p className="page-subtitle">管理账号状态、执行权限和资源配额。</p></div><button className="button button-outline" onClick={() => void load()}><RefreshCw size={18} />刷新</button></div>
    <section className="panel table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>任务</th><th>模板</th><th>最近登录</th><th /></tr></thead><tbody>
      {items.map((user) => <tr key={user.id}><td><strong>{user.username}</strong></td><td>{user.role === "admin" ? "运营管理员" : "普通用户"}</td><td><span className={`status-badge ${user.status === "active" ? "status-success" : "status-failure"}`}>{user.status === "active" ? "正常" : "已停用"}</span></td><td>{user.enabledTaskCount}/{user.taskCount}</td><td>{user.templateCount}</td><td>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "尚未登录"}</td><td><button className="button button-outline button-small" onClick={() => open(user)}>管理</button></td></tr>)}
    </tbody></table>{items.length === 0 ? <div className="empty-state">暂无普通用户。</div> : null}</section>
    {selected && draft ? <Modal title={`管理用户 · ${draft.username}`} size="large" onClose={() => { setSelected(undefined); setDraft(undefined); }}>
      <div className="modal-body page-stack">
        <div className="admin-user-actions">
          <button className="button button-outline" onClick={() => setDraft({ ...draft, status: draft.status === "active" ? "suspended" : "active" })}><UserX size={17} />{draft.status === "active" ? "停用账号" : "恢复账号"}</button>
          <button className="button button-outline" onClick={() => void action("revoke")}><UserRoundCog size={17} />强制退出</button>
          <button className="button button-outline" onClick={() => void action("reset")}><KeyRound size={17} />生成重置链接</button>
          {owner ? <button className="button button-outline" onClick={() => void action("role")}><Shield size={17} />{draft.role === "admin" ? "降为普通用户" : "提升为运营管理员"}</button> : null}
        </div>
        {resetPath ? <div className="form-note"><strong>一次性重置路径（15 分钟有效）</strong><code>{resetPath}</code></div> : null}
        {draft.role === "user" ? <>
          <section><h3>功能权限</h3><div className="permission-grid">{(Object.keys(capabilityLabels) as Array<keyof UserCapabilities>).map((key) => <label className="check-row" key={key}><input type="checkbox" checked={draft.capabilities[key]} onChange={(event) => setDraft({ ...draft, capabilities: { ...draft.capabilities, [key]: event.target.checked } })} /><span>{capabilityLabels[key]}</span></label>)}</div></section>
          <section><h3>资源配额</h3><div className="settings-grid"><NumberInput label="任务上限" value={draft.quotas.maxTasks} onChange={(value) => setDraft({ ...draft, quotas: { ...draft.quotas, maxTasks: value } })} /><NumberInput label="启用计划上限" value={draft.quotas.maxEnabledTasks} onChange={(value) => setDraft({ ...draft, quotas: { ...draft.quotas, maxEnabledTasks: value } })} /><NumberInput label="每日操作上限" value={draft.quotas.maxDailyActions} onChange={(value) => setDraft({ ...draft, quotas: { ...draft.quotas, maxDailyActions: value } })} /></div></section>
        </> : <div className="form-note">运营管理员不受普通用户功能开关和配额限制。</div>}
        {owner && draft.status === "suspended" ? <section className="danger-zone"><h3>永久删除</h3><p>将删除该用户的任务、模板、会话、记录和截图。审计记录会保留。</p><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={`输入 ${draft.username} 确认`} /><button className="button button-danger" onClick={() => void remove()}>永久删除用户</button></section> : null}
      </div>
      <footer className="modal-footer"><button className="button button-outline" onClick={() => { setSelected(undefined); setDraft(undefined); }}>取消</button><button className="button button-primary" onClick={() => void save()}>保存权限</button></footer>
    </Modal> : null}
  </div>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="number-field"><span>{label}</span><div><input type="number" min={0} max={10000} value={value} onChange={(event) => onChange(Number(event.target.value))} /><b>项</b></div></label>;
}
