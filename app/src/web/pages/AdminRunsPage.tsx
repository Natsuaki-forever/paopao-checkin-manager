import { useEffect, useState } from "react";
import type { RunRecord } from "../../shared/types";
import { api } from "../api";
import { formatDateTime, runStatusText, statusTone } from "../utils";

export function AdminRunsPage() {
  const [items, setItems] = useState<RunRecord[]>([]);
  useEffect(() => { void api<{ items: RunRecord[] }>("/api/admin/runs?limit=100").then((result) => setItems(result.items)); }, []);
  return <div className="page-stack">
    <div className="page-heading"><div><h1>全站运行</h1><p className="page-subtitle">查看所有用户的最近运行结果，不显示账号或会话秘密。</p></div></div>
    <section className="panel table-wrap"><table><thead><tr><th>任务</th><th>用户标识</th><th>状态</th><th>触发方式</th><th>完成时间</th><th>结果</th></tr></thead><tbody>{items.map((run) => { const tone = statusTone(run.status); return <tr key={run.id}><td><strong>{run.taskName}</strong></td><td><code>{run.ownerUserId ? run.ownerUserId.slice(0, 8) : "主管理员"}</code></td><td><span className={`status-badge status-${tone === "danger" ? "failure" : tone === "success" ? "success" : "pending"}`}>{runStatusText(run.status)}</span></td><td>{run.trigger === "scheduled" ? "定时" : "手动"}</td><td>{formatDateTime(run.finishedAt)}</td><td>{run.message}{run.hasScreenshot ? <a className="text-link table-secondary" href={`/api/admin/runs/${run.id}/screenshot`} target="_blank" rel="noreferrer">查看失败截图</a> : null}</td></tr>; })}</tbody></table>{items.length === 0 ? <div className="empty-state">暂无运行记录。</div> : null}</section>
  </div>;
}
