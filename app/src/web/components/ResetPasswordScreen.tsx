import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postJson } from "../api";
import { ThemeToggle } from "./ThemeToggle";

export function ResetPasswordScreen({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 10) return setError("新密码至少需要 10 个字符");
    if (password !== confirmation) return setError("两次输入的密码不一致");
    setSaving(true); setError("");
    try {
      await postJson(`/api/auth/reset/${token}`, { password });
      onComplete();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "密码重置失败");
    } finally { setSaving(false); }
  };
  return <div className="auth-page"><ThemeToggle className="auth-theme-toggle" /><section className="auth-card"><div className="auth-icon"><KeyRound size={31} /></div><h1>设置新密码</h1><p>重置链接只能使用一次。</p><form onSubmit={submit}><label className="field-label" htmlFor="reset-password">新密码</label><input id="reset-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><label className="field-label" htmlFor="reset-confirm">确认新密码</label><input id="reset-confirm" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" />{error ? <div className="form-error">{error}</div> : null}<button className="button button-primary auth-submit" disabled={saving}>{saving ? "保存中…" : "保存新密码"}</button></form></section></div>;
}
