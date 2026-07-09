import { KeyRound, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postJson } from "../api";

export function AccountPage({
  displayName,
  role,
  owner,
  notify,
}: {
  displayName: string;
  role: "user" | "admin";
  owner: boolean;
  notify: (message: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 10) return notify("新密码至少需要 10 个字符");
    if (newPassword !== confirmation) return notify("两次输入的新密码不一致");
    setSaving(true);
    try {
      await postJson(owner ? "/api/settings/password" : "/api/auth/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      notify("密码已更新，其他登录会话已退出");
    } catch (error) {
      notify(error instanceof Error ? error.message : "密码修改失败");
    } finally {
      setSaving(false);
    }
  };
  return <div className="page-stack account-page">
    <div className="page-heading"><div><h1>我的账户</h1><p className="page-subtitle">查看当前身份并维护登录密码。</p></div></div>
    <section className="panel settings-section account-identity-card">
      <div className="settings-section-title"><ShieldCheck size={22} /><div><h2>{displayName}</h2><p>{owner ? "主管理员" : role === "admin" ? "运营管理员" : "普通用户"}</p></div></div>
    </section>
    <section className="panel settings-section account-password-card">
      <div className="settings-section-title"><KeyRound size={22} /><div><h2>修改密码</h2><p>修改后会撤销其他设备上的登录会话。</p></div></div>
      <form className="password-settings-form" onSubmit={submit}>
        <label><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
        <label><span>新密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
        <label><span>确认新密码</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>
        <button className="button button-primary" disabled={saving}>{saving ? "保存中…" : "保存新密码"}</button>
      </form>
    </section>
  </div>;
}
