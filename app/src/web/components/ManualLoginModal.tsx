import { Check, Crosshair, Keyboard, RefreshCw, Save, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { ManualElementSelection, ManualLoginState, TaskSummary } from "../../shared/types";
import { api, postJson } from "../api";
import { Modal } from "./Modal";

interface Props {
  task: TaskSummary;
  notify: (message: string) => void;
  onClose: (saved: boolean) => void;
}

export function ManualLoginModal({ task, notify, onClose }: Props) {
  const [session, setSession] = useState<ManualLoginState>();
  const [text, setText] = useState("");
  const [secret, setSecret] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(600);
  const [pickingElement, setPickingElement] = useState(false);
  const [selection, setSelection] = useState<ManualElementSelection>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void postJson<ManualLoginState>(`/api/tasks/${task.id}/manual-login/start`)
      .then((value) => {
        setSession(value);
        setRefresh(Date.now());
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法开始人工登录"))
      .finally(() => setBusy(false));
  }, [task.id]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  const update = async (operation: () => Promise<ManualLoginState>) => {
    setBusy(true);
    setError("");
    try {
      setSession(await operation());
      setRefresh(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const clickScreenshot = (event: MouseEvent<HTMLImageElement>) => {
    if (!session || busy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(session.viewportWidth - 1,
      Math.round((event.clientX - rect.left) * session.viewportWidth / rect.width)));
    const y = Math.max(0, Math.min(session.viewportHeight - 1,
      Math.round((event.clientY - rect.top) * session.viewportHeight / rect.height)));
    if (pickingElement) {
      setBusy(true);
      setError("");
      void postJson<ManualElementSelection>(`/api/manual-login/${session.id}/element/inspect`, { x, y })
        .then(setSelection)
        .catch((reason) => setError(reason instanceof Error ? reason.message : "无法识别该元素"))
        .finally(() => setBusy(false));
      return;
    }
    void update(() => postJson(`/api/manual-login/${session.id}/click`, { x, y }));
  };

  const confirmSelection = async () => {
    if (!session || !selection) return;
    setBusy(true);
    setError("");
    try {
      const saved = await postJson<ManualElementSelection>(`/api/manual-login/${session.id}/element/confirm`);
      setSelection(saved);
      setPickingElement(false);
      notify(`已将“${saved.label}”保存为 ${task.name} 的签到元素`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存元素失败");
    } finally {
      setBusy(false);
    }
  };

  const sendText = () => {
    if (!session || !text) return;
    const value = text;
    setText("");
    void update(() => postJson(`/api/manual-login/${session.id}/type`, { text: value }));
  };

  const pressKey = (key: string) => {
    if (session) void update(() => postJson(`/api/manual-login/${session.id}/key`, { key }));
  };

  const cancel = async () => {
    if (session) await postJson<void>(`/api/manual-login/${session.id}/cancel`).catch(() => undefined);
    onClose(false);
  };

  const save = async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await postJson<void>(`/api/manual-login/${session.id}/save`);
      notify(`${task.name} 的登录会话已加密保存`);
      onClose(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存会话失败");
      setBusy(false);
    }
  };

  return (
    <Modal title={`人工登录 · ${task.name}`} size="large" onClose={() => void cancel()}>
      <div className="modal-body manual-login-body">
        <div className="inline-info">
          在下方页面依次点击账号、密码和验证码位置，再发送输入。会话 10 分钟后自动关闭，输入不会在此页面回显或写入日志。
        </div>
        {session ? (
          <>
            <div className="manual-login-status">
              <span>{session.title || "登录页面"}</span>
              <span>剩余 {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>
              <small title={session.url}>{session.url}</small>
            </div>
            <div className={`manual-browser-frame ${busy ? "is-busy" : ""} ${pickingElement ? "is-picking" : ""}`}>
              <img
                src={`/api/manual-login/${session.id}/screenshot?v=${refresh}`}
                alt="远程登录页面"
                draggable={false}
                onClick={clickScreenshot}
              />
              {pickingElement && selection ? <span
                className="manual-element-highlight"
                style={{
                  left: `${selection.rect.x / session.viewportWidth * 100}%`,
                  top: `${selection.rect.y / session.viewportHeight * 100}%`,
                  width: `${selection.rect.width / session.viewportWidth * 100}%`,
                  height: `${selection.rect.height / session.viewportHeight * 100}%`,
                }}
              /> : null}
              {busy ? <span>处理中…</span> : null}
            </div>
            <div className="manual-input-row">
              <input
                type={secret ? "password" : "text"}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); sendText(); } }}
                placeholder="先点击页面中的输入框，再在这里输入内容"
                autoComplete="off"
              />
              <button type="button" className="button button-primary" disabled={!text || busy} onClick={sendText}>
                <Send size={17} />发送输入
              </button>
            </div>
            <div className="manual-tools">
              <label><input type="checkbox" checked={secret} onChange={(event) => setSecret(event.target.checked)} />敏感输入</label>
              <span><Keyboard size={16} />按键：</span>
              {(["Tab", "Enter", "Backspace", "Escape"] as const).map((key) => (
                <button type="button" key={key} disabled={busy} onClick={() => pressKey(key)}>{key}</button>
              ))}
              <button type="button" disabled={busy} onClick={() => setRefresh(Date.now())}><RefreshCw size={15} />刷新画面</button>
            </div>
            <div className="manual-checkin-row">
              <button type="button" className="button button-neutral" disabled={busy} onClick={() => { setSelection(undefined); void update(() => postJson(`/api/manual-login/${session.id}/checkin`)); }}>
                登录后打开签到页
              </button>
              <button type="button" className={`button ${pickingElement ? "button-outline" : "button-neutral"}`} disabled={busy} onClick={() => { setPickingElement((value) => !value); setSelection(undefined); }}>
                <Crosshair size={17} />{pickingElement ? "选择中…" : "选择签到元素"}
              </button>
            </div>
            {pickingElement ? <div className="manual-picker-panel">
              <p>{selection ? "已高亮选中元素，确认后才会写入任务配置；此过程不会点击目标网页。" : "请在上方画面中点击签到按钮或它的图片。本次点击只用于选择，不会触发网页操作。"}</p>
              {selection ? <div className="manual-picker-result">
                <div><strong>{selection.label}</strong><code>{selection.selector}</code><small>{selection.tag} · {selection.strategy}</small></div>
                <button type="button" className="button button-primary button-small" disabled={busy} onClick={() => void confirmSelection()}><Check size={16} />确认使用此元素</button>
                <button type="button" className="icon-button" aria-label="取消元素选择" onClick={() => setSelection(undefined)}><X size={18} /></button>
              </div> : null}
            </div> : null}
          </>
        ) : busy ? <div className="manual-login-loading">正在打开登录页面…</div> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </div>
      <footer className="modal-footer">
        <button type="button" className="button button-neutral" onClick={() => void cancel()}>取消并关闭</button>
        <button type="button" className="button button-primary" disabled={!session || busy} onClick={() => void save()}>
          <Save size={18} />保存登录会话
        </button>
      </footer>
    </Modal>
  );
}
