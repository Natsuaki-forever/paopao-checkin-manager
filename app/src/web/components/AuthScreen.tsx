import { CalendarDays, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postJson } from "../api";

import { ThemeToggle } from "./ThemeToggle";
import { AuthVisual } from "./AuthVisual";
interface AuthScreenProps {
  mode: "setup" | "login";
  runtimeMode: "simulation" | "production";
  onSuccess: () => void;
}

export function AuthScreen({ mode, runtimeMode, onSuccess }: AuthScreenProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 10) {
      setError("主密码至少需要 10 个字符");
      return;
    }
    if (mode === "setup" && password !== confirmation) {
      setError("两次输入的主密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      await postJson(`/api/auth/${mode}`, { password });
      onSuccess();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <ThemeToggle className="auth-theme-toggle" />
      <AuthVisual />
      <section className="auth-card">
        <div className="auth-brand"><CalendarDays size={32} />炮炮签到站</div>
        <div className="auth-icon"><ShieldCheck size={31} /></div>
        <h1>{mode === "setup" ? "首次设置" : "管理员登录"}</h1>
        <p>
          {mode === "setup"
            ? "创建用于进入管理后台的主密码。密码只保存安全哈希。"
            : "请输入主密码进入炮炮签到站。"}
        </p>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="master-password">主密码</label>
          <div className="password-field">
            <input
              id="master-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              placeholder="至少 10 个字符"
              autoFocus
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          {mode === "setup" ? (
            <>
              <label className="field-label" htmlFor="confirm-password">确认主密码</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                placeholder="再次输入主密码"
              />
            </>
          ) : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button type="submit" className="button button-primary auth-submit" disabled={submitting}>
            {submitting ? "正在处理…" : mode === "setup" ? "完成设置" : "登录"}
          </button>
        </form>
        <div className="auth-runtime-note">
          {runtimeMode === "production"
            ? "当前为正式模式，任务执行会访问已配置的网站。"
            : "当前为本地模拟模式，不会访问外部网站或发送通知。"}
        </div>
      </section>
    </div>
  );
}
