import { CalendarDays, Eye, EyeOff, ShieldCheck, UserPlus, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postJson } from "../api";
import { ThemeToggle } from "./ThemeToggle";
import { PigTankEasterEgg } from "./PigTankEasterEgg";
import { useEasterEggSequence } from "../hooks/useEasterEggSequence";
import { AuthVisual } from "./AuthVisual";
import pigAdmin from "../assets/auth-mascot/pig-admin.webp";
import pigLove from "../assets/auth-mascot/pig-love.webp";
import pigShy from "../assets/auth-mascot/pig-shy.webp";
import pigWave from "../assets/auth-mascot/pig-wave.webp";

type AuthView = "user-login" | "register" | "admin-login";

interface AccountAuthScreenProps {
  runtimeMode: "simulation" | "production";
  registrationEnabled: boolean;
  registrationMode?: "closed" | "invite" | "public";
  onSuccess: () => void;
}

const copy = {
  brand: "\u70ae\u70ae\u7b7e\u5230\u7ad9",
  userLogin: "\u7528\u6237\u767b\u5f55",
  userLoginHelp: "\u767b\u5f55\u540e\u7ba1\u7406\u7b7e\u5230\u4efb\u52a1\u3002",
  register: "\u6ce8\u518c\u8d26\u53f7",
  registerHelp: "\u521b\u5efa\u7528\u6237\u540d\u548c\u5bc6\u7801\u3002",
  adminLogin: "\u7ba1\u7406\u5458\u767b\u5f55",
  adminLoginHelp: "\u4f7f\u7528\u7ba1\u7406\u5458\u4e3b\u5bc6\u7801\u8fdb\u5165\u3002",
  username: "\u7528\u6237\u540d",
  password: "\u5bc6\u7801",
  adminPassword: "\u4e3b\u5bc6\u7801",
  confirmation: "\u786e\u8ba4\u5bc6\u7801",
  submitLogin: "\u767b\u5f55",
  submitRegister: "\u6ce8\u518c\u5e76\u767b\u5f55",
  adminEntry: "\u7ba1\u7406\u5458\u5165\u53e3",
  backToUser: "\u8fd4\u56de\u7528\u6237\u767b\u5f55",
  noAccount: "\u8fd8\u6ca1\u6709\u8d26\u53f7\uff1f",
  createAccount: "\u6ce8\u518c",
  hasAccount: "\u5df2\u6709\u8d26\u53f7\uff1f",
  processing: "\u6b63\u5728\u5904\u7406\u2026",
  show: "\u663e\u793a\u5bc6\u7801",
  hide: "\u9690\u85cf\u5bc6\u7801",
  usernameHint: "3-32 \u4e2a\u5b57\u7b26",
  passwordHint: "\u81f3\u5c11 10 \u4e2a\u5b57\u7b26",
  mismatch: "\u4e24\u6b21\u8f93\u5165\u7684\u5bc6\u7801\u4e0d\u4e00\u81f4",
  usernameShort: "\u7528\u6237\u540d\u81f3\u5c11\u9700\u8981 3 \u4e2a\u5b57\u7b26",
  passwordShort: "\u5bc6\u7801\u81f3\u5c11\u9700\u8981 10 \u4e2a\u5b57\u7b26",
  failed: "\u64cd\u4f5c\u5931\u8d25",
};

export function AccountAuthScreen({
  runtimeMode,
  registrationEnabled,
  registrationMode,
  onSuccess,
}: AccountAuthScreenProps) {
  const [view, setView] = useState<AuthView>("user-login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const loginPig = useEasterEggSequence({ clicks: 7, windowMs: 4_000 });

  const switchView = (next: AuthView) => {
    setView(next);
    setPassword("");
    setConfirmation("");
    setInviteCode("");
    setError("");
    setPasswordFocused(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (view !== "admin-login" && username.trim().length < 3) {
      setError(copy.usernameShort);
      return;
    }
    if (password.length < 10) {
      setError(copy.passwordShort);
      return;
    }
    if (view === "register" && password !== confirmation) {
      setError(copy.mismatch);
      return;
    }
    setSubmitting(true);
    try {
      const endpoint = view === "admin-login"
        ? "/api/auth/login"
        : view === "register"
          ? "/api/auth/register"
          : "/api/auth/user-login";
      const payload = view === "admin-login"
        ? { password }
        : { username: username.trim(), password, ...(isRegister && registrationMode === "invite" ? { inviteCode: inviteCode.trim() } : {}) };
      await postJson(endpoint, payload);
      onSuccess();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.failed);
    } finally {
      setSubmitting(false);
    }
  };

  const isAdmin = view === "admin-login";
  const isRegister = view === "register";
  const Icon = isAdmin ? ShieldCheck : isRegister ? UserPlus : UserRound;
  const title = isAdmin ? copy.adminLogin : isRegister ? copy.register : copy.userLogin;
  const help = isAdmin ? copy.adminLoginHelp : isRegister ? copy.registerHelp : copy.userLoginHelp;
  const mascot = isAdmin
    ? { src: pigAdmin, pose: "admin", label: "戴上墨镜的小猪管理员" }
    : isRegister
      ? { src: pigLove, pose: "love", label: "期待新用户的小猪" }
      : passwordFocused
        ? { src: pigShy, pose: "shy", label: "捂住眼睛保护密码的小猪" }
        : { src: pigWave, pose: "wave", label: "挥手欢迎的小猪" };

  return (
    <div className="auth-page">
      <ThemeToggle className="auth-theme-toggle" />
      <AuthVisual />
      <section className="auth-card">
        <div className={`auth-mascot auth-mascot-${mascot.pose}`} key={mascot.pose} aria-label={mascot.label} role="img">
          <img src={mascot.src} alt="" />
        </div>
        <div className="auth-brand"><button type="button" className="secret-trigger" aria-label="炮炮签到站日历图标" onClick={loginPig.trigger}><CalendarDays size={32} /></button>{copy.brand}{loginPig.visible ? <PigTankEasterEgg variant="peek" /> : null}</div>
        <div className="auth-icon"><Icon size={31} /></div>
        <h1>{title}</h1>
        <p>{help}</p>
        <form onSubmit={submit}>
          {!isAdmin ? (
            <>
              <label className="field-label" htmlFor="account-username">{copy.username}</label>
              <input
                id="account-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder={copy.usernameHint}
                autoFocus
              />
            </>
          ) : null}
          <label className="field-label" htmlFor="account-password">
            {isAdmin ? copy.adminPassword : copy.password}
          </label>
          <div className="password-field">
            <input
              id="account-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onPointerDown={() => setPasswordFocused(true)}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              autoComplete={isRegister ? "new-password" : "current-password"}
              placeholder={copy.passwordHint}
              autoFocus={isAdmin}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? copy.hide : copy.show}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          {isRegister ? (
            <>
              {registrationMode === "invite" ? (
                <>
                  <label className="field-label" htmlFor="account-invite">邀请码</label>
                  <input
                    id="account-invite"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                    autoComplete="off"
                    placeholder="输入管理员提供的邀请码"
                    required
                  />
                </>
              ) : null}
              <label className="field-label" htmlFor="account-confirmation">{copy.confirmation}</label>
              <input
                id="account-confirmation"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                placeholder={copy.confirmation}
              />
            </>
          ) : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button type="submit" className="button button-primary auth-submit" disabled={submitting}>
            {submitting ? copy.processing : isRegister ? copy.submitRegister : copy.submitLogin}
          </button>
        </form>
        {!isAdmin ? (
          <>
            {registrationEnabled ? (
              <div className="auth-switch">
                <span>{isRegister ? copy.hasAccount : copy.noAccount}</span>
                <button type="button" className="text-link" onClick={() => switchView(isRegister ? "user-login" : "register")}>
                  {isRegister ? copy.submitLogin : copy.createAccount}
                </button>
              </div>
            ) : null}
            <button type="button" className="admin-entry" onClick={() => switchView("admin-login")}>
              <ShieldCheck size={17} />{copy.adminEntry}
            </button>
          </>
        ) : (
          <button type="button" className="admin-entry" onClick={() => switchView("user-login")}>
            <UserRound size={17} />{copy.backToUser}
          </button>
        )}
        <div className="auth-runtime-note">
          {runtimeMode === "production"
            ? "\u5f53\u524d\u4e3a\u6b63\u5f0f\u6a21\u5f0f\uff0c\u4efb\u52a1\u6267\u884c\u4f1a\u8bbf\u95ee\u5df2\u914d\u7f6e\u7684\u7f51\u7ad9\u3002"
            : "\u5f53\u524d\u4e3a\u672c\u5730\u6a21\u62df\u6a21\u5f0f\uff0c\u4e0d\u4f1a\u8bbf\u95ee\u5916\u90e8\u7f51\u7ad9\u6216\u53d1\u9001\u901a\u77e5\u3002"}
        </div>
      </section>
    </div>
  );
}

