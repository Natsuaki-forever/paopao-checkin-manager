import { Check, Eye, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { TemplateSubmission } from "../../shared/types";
import { api, postJson } from "../api";
import { Modal } from "../components/Modal";
import { formatDateTime } from "../utils";

export function TemplateReviewPage({ notify }: { notify: (message: string) => void }) {
  const [items, setItems] = useState<TemplateSubmission[]>([]);
  const [selected, setSelected] = useState<TemplateSubmission>();
  const [note, setNote] = useState("");
  const load = async () => setItems((await api<{ items: TemplateSubmission[] }>("/api/admin/template-submissions")).items);
  useEffect(() => { void load(); }, []);
  const review = async (decision: "approve" | "reject") => {
    if (!selected) return;
    try {
      await postJson(`/api/admin/template-submissions/${selected.id}/review`, { decision, note });
      notify(decision === "approve" ? "模板已发布到共享库" : "模板已驳回");
      setSelected(undefined); setNote(""); await load();
    } catch (error) { notify(error instanceof Error ? error.message : "审核失败"); }
  };
  return <div className="page-stack">
    <div className="page-heading"><div><h1>模板审核</h1><p className="page-subtitle">审核用户提交的浏览器模板快照。</p></div></div>
    <section className="panel table-wrap"><table><thead><tr><th>模板</th><th>提交用户</th><th>状态</th><th>提交时间</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small className="table-secondary">{item.description || "无说明"}</small></td><td>{item.submitterName}</td><td><span className={`status-badge status-${item.status === "approved" ? "success" : item.status === "rejected" ? "failure" : "pending"}`}>{statusText(item.status)}</span></td><td>{formatDateTime(item.createdAt)}</td><td><button className="button button-outline button-small" onClick={() => { setSelected(item); setNote(""); }}><Eye size={16} />查看</button></td></tr>)}</tbody></table>{items.length === 0 ? <div className="empty-state">暂无模板投稿。</div> : null}</section>
    {selected ? <Modal title={selected.name} size="large" onClose={() => setSelected(undefined)}><div className="modal-body page-stack"><p>{selected.description || "无模板说明"}</p><div className="template-config-preview"><pre>{JSON.stringify(selected.config, null, 2)}</pre></div>{selected.status === "pending" ? <label><span>审核说明</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} /></label> : selected.reviewNote ? <div className="form-note">审核说明：{selected.reviewNote}</div> : null}</div>{selected.status === "pending" ? <footer className="modal-footer"><button className="button button-outline" onClick={() => void review("reject")}><X size={17} />驳回</button><button className="button button-primary" onClick={() => void review("approve")}><Check size={17} />通过并发布</button></footer> : null}</Modal> : null}
  </div>;
}

function statusText(status: TemplateSubmission["status"]): string {
  return ({ pending: "待审核", approved: "已发布", rejected: "已驳回", withdrawn: "已撤回" })[status];
}
