import { ExternalLink, Eye, EyeOff, Info, Save, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  NotificationChannel,
  NotificationChannelConfig,
  NotificationTemplate,
  TemplateStatus,
} from "../../shared/types";
import { api, postJson, putJson } from "../api";

const channelNames: Record<NotificationChannel, string> = {
  serverchan: "Server酱",
  wechat: "企业微信群机器人",
  bark: "Bark",
  telegram: "Telegram",
  webhook: "自定义 Webhook",
};
const channelInfo: Record<NotificationChannel, {
  field: string;
  placeholder: string;
  description: string;
  format: string;
  href?: string;
  linkLabel?: string;
}> = {
  serverchan: {
    field: "SendKey",
    placeholder: "例如 SCT…",
    description: "登录 Server酱后，在顶部“SendKey”页面复制。",
    format: "只填写 SendKey，不要填写完整发送地址。",
    href: "https://sct.ftqq.com/sendkey",
    linkLabel: "打开 Server酱 SendKey",
  },
  wechat: {
    field: "Webhook 地址",
    placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…",
    description: "在企业微信群的群设置中添加“群机器人”，然后复制机器人 Webhook。",
    format: "需要完整的 HTTPS Webhook 地址。",
    href: "https://developer.work.weixin.qq.com/document/path/91770",
    linkLabel: "查看企业微信官方说明",
  },
  bark: {
    field: "设备 Key",
    placeholder: "Bark 测试地址中的设备 Key",
    description: "打开 Bark App，复制首页测试地址；取 api.day.app/ 后面的第一段 Key。",
    format: "这里只填写设备 Key，不填写完整 URL。",
    href: "https://github.com/Finb/Bark#usage",
    linkLabel: "查看 Bark 官方用法",
  },
  telegram: {
    field: "Bot Token | Chat ID",
    placeholder: "botToken|chatId",
    description: "通过 Telegram 的 @BotFather 创建机器人并取得 Token，再取得接收消息的 Chat ID。",
    format: "按 botToken|chatId 格式填写，中间使用英文竖线。",
    href: "https://core.telegram.org/bots/features#botfather",
    linkLabel: "查看 Telegram BotFather 指南",
  },
  webhook: {
    field: "HTTPS Webhook 地址",
    placeholder: "https://example.com/hooks/checkin",
    description: "填写你自己的接收端地址。系统会 POST JSON，字段为 title 和 content。",
    format: "必须使用 HTTPS，并由接收端自行校验鉴权信息。",
  },
};
const templateNames: Record<TemplateStatus, string> = {
  success: "签到成功",
  already_checked: "今日已签到",
  failure: "签到失败",
};
const variables = ["siteName", "status", "message", "finishedAt", "duration"];
const previewValues: Record<string, string> = {
  siteName: "示例站点",
  status: "签到成功",
  message: "模拟签到成功，未访问目标网站",
  finishedAt: "2026-06-29 08:00:12",
  duration: "1.23 秒",
};

interface NotificationResponse {
  channels: NotificationChannelConfig[];
  templates: NotificationTemplate[];
}

export function NotificationsPage({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<NotificationResponse>({ channels: [], templates: [] });
  const [channel, setChannel] = useState<NotificationChannel>("serverchan");
  const [status, setStatus] = useState<TemplateStatus>("success");
  const [content, setContent] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const response = await api<NotificationResponse>("/api/notifications");
    setData(response);
    const template = response.templates.find((item) => item.channel === channel && item.status === status);
    setContent(template?.content || "");
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const template = data.templates.find((item) => item.channel === channel && item.status === status);
    setContent(template?.content || "");
  }, [channel, status, data.templates]);

  const config = data.channels.find((item) => item.channel === channel);
  const info = channelInfo[channel];
  const rendered = useMemo(
    () => content.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_match, name: string) => previewValues[name] || ""),
    [content],
  );

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([
        putJson(`/api/notifications/channels/${channel}`, {
          enabled: config?.enabled || false,
          secret: secret || undefined,
        }),
        putJson(`/api/notifications/templates/${channel}/${status}`, { content }),
      ]);
      setSecret("");
      notify("通知设置已保存");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = (enabled: boolean) => {
    setData((current) => ({
      ...current,
      channels: current.channels.map((item) => item.channel === channel ? { ...item, enabled } : item),
    }));
  };

  const test = async () => {
    const result = await postJson<{ message: string }>(`/api/notifications/test/${channel}`);
    notify(result.message);
  };

  const insertVariable = (name: string) => setContent((value) => `${value}${value ? " " : ""}{{${name}}}`);

  return (
    <div className="page-stack">
      <div className="page-heading"><div><h1>通知设置</h1></div></div>
      <div className="channel-tabs" role="tablist">
        {(["serverchan", "wechat", "bark", "telegram", "webhook"] as NotificationChannel[]).map((item) => <button key={item} type="button" role="tab" aria-selected={channel === item} className={channel === item ? "tab-active" : ""} onClick={() => { setChannel(item); setSecret(""); }}>{channelNames[item]}</button>)}
      </div>
      <section className="panel notification-channel-panel">
        <div className="panel-title-row"><h2>{channelNames[channel]}设置</h2><label className="enabled-check"><input type="checkbox" checked={config?.enabled || false} onChange={(event) => toggleEnabled(event.target.checked)} />启用渠道</label></div>
        <div className="channel-help"><div><strong>{info.description}</strong><span>{info.format}</span></div>{info.href ? <a href={info.href} target="_blank" rel="noreferrer">{info.linkLabel}<ExternalLink size={15} /></a> : null}</div>
        <div className="channel-config-row">
          <label className="channel-secret"><span>{info.field}<b>*</b></span><div className="password-field compact-password"><input type={showSecret ? "text" : "password"} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={config?.configured ? `${config.secretMasked}（留空保持不变）` : info.placeholder} /><button type="button" className="password-toggle" onClick={() => setShowSecret((value) => !value)} aria-label={showSecret ? "隐藏密钥" : "显示密钥"}>{showSecret ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></label>
          <button type="button" className="button button-outline" onClick={() => void test()}><Send size={18} />测试发送</button>
          <button type="button" className="button button-primary channel-save" onClick={() => void save()} disabled={saving}><Save size={18} />{saving ? "保存中…" : "保存设置"}</button>
        </div>
        <div className="security-note"><Info size={19} /><span>安全说明：通知中不会包含账号、密码、Cookie 或截图内容</span></div>
      </section>

      <section className="panel template-panel">
        <h2>通知模板</h2>
        <div className="template-tabs" role="tablist">
          {(["success", "already_checked", "failure"] as TemplateStatus[]).map((item) => <button type="button" role="tab" aria-selected={status === item} key={item} className={status === item ? "tab-active" : ""} onClick={() => setStatus(item)}>{templateNames[item]}</button>)}
        </div>
        <div className="template-grid">
          <div className="template-editor"><label htmlFor="template-content">模板编辑</label><textarea id="template-content" value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} /><div className="editor-count">{content.length} / 2000</div><span className="variables-label">可用变量：</span><div className="variables-row">{variables.map((variable) => <button type="button" key={variable} onClick={() => insertVariable(variable)}>{`{{${variable}}}`}</button>)}</div></div>
          <div className="template-preview"><span className="preview-label">实时预览</span><div className="preview-card"><div className="preview-content">{rendered || "模板预览将显示在这里"}</div><small>预览内容为示例，实际发送内容以运行时为准</small></div></div>
        </div>
      </section>
    </div>
  );
}
