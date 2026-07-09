import { useEffect, useState } from "react";
import type { AuditEvent } from "../../shared/types";
import { api } from "../api";
import { formatDateTime } from "../utils";

export function AuditPage() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  useEffect(() => { void api<{ items: AuditEvent[] }>("/api/admin/audit?limit=100").then((result) => setItems(result.items)); }, []);
  return <div className="page-stack">
    <div className="page-heading"><div><h1>审计日志</h1><p className="page-subtitle">记录用户管理、任务处置、会话、模板和系统配置操作。</p></div></div>
    <section className="panel table-wrap"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>结果</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{formatDateTime(item.createdAt)}</td><td>{item.actorDisplayName}<small className="table-secondary">{item.actorOwner ? "主管理员" : item.actorRole === "admin" ? "运营管理员" : "普通用户"}</small></td><td><code>{item.action}</code></td><td>{item.targetLabel || item.targetId || item.targetType}</td><td>{item.result === "success" ? "成功" : item.result === "denied" ? "已拒绝" : "失败"}</td></tr>)}</tbody></table>{items.length === 0 ? <div className="empty-state">暂无审计记录。</div> : null}</section>
  </div>;
}
