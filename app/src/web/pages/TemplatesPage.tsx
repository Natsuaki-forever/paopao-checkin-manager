import { Copy, Download, FileUp, Globe2, Pencil, Plus, Send, Trash2, Workflow, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { ExecutionTemplate, TaskTemplateId, UserCapabilities } from "../../shared/types";
import { defaultBrowserFormTemplateConfig } from "../../shared/browser-form";
import { api, postJson, putJson } from "../api";
import { HarImportWorkflow } from "../components/HarImportWorkflow";

const adapterNames: Record<TaskTemplateId, string> = {
  browser_form: "网页登录",
  http_flow: "HTTP 流程",
};

type TemplateTab = "preset" | "shared" | "mine" | "submissions";

const templateCategoryCopy: Record<TemplateTab, { label: string; title: string; description: string }> = {
  preset: {
    label: "系统预置",
    title: "系统预置模板",
    description: "只读基线，添加任务时可直接选择。",
  },
  shared: {
    label: "共享模板",
    title: "共享模板",
    description: "审核发布的公共模板，适合复用。",
  },
  mine: {
    label: "我的模板",
    title: "我的模板",
    description: "可维护的个人模板和任务专用副本。",
  },
  submissions: {
    label: "我的投稿",
    title: "我的投稿",
    description: "查看共享模板的审核状态。",
  },
};

export function TemplatesPage({ notify, capabilities }: { notify: (message: string) => void; capabilities: UserCapabilities }) {
  const [items, setItems] = useState<ExecutionTemplate[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSource, setCreateSource] = useState<"manual" | "har">("manual");
  const [createName, setCreateName] = useState("");
  const [createAdapter, setCreateAdapter] = useState<TaskTemplateId>("browser_form");
  const [firstUrl, setFirstUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [submissions, setSubmissions] = useState<Array<{ id: string; name: string; status: string; reviewNote?: string }>>([]);
  const [activeTab, setActiveTab] = useState<TemplateTab>("preset");
  const load = async () => {
    const [templateResult, submissionResult] = await Promise.all([
      api<{ items: ExecutionTemplate[] }>("/api/templates"),
      api<{ items: Array<{ id: string; name: string; status: string; reviewNote?: string }> }>("/api/template-submissions"),
    ]);
    setItems(templateResult.items);
    setSubmissions(submissionResult.items);
  };
  useEffect(() => {
    void load();
    if (capabilities.importHar && window.location.hash.replace(/^#\/?/, "") === "har") {
      setCreateSource("har");
      setCreateOpen(true);
      window.location.hash = "templates";
    }
  }, []);

  const openCreate = () => {
    setCreateName("");
    setCreateAdapter("browser_form");
    setCreateSource("manual");
    setFirstUrl("");
    setCreateOpen(true);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    try {
      if (createAdapter === "http_flow") {
        await postJson("/api/templates", {
          name: createName.trim(),
          adapterId: "http_flow",
          config: {
            version: 1,
            kind: "http_flow",
            steps: [{ id: "step-1", name: "请求", method: "GET", url: firstUrl.trim() }],
          },
        });
      } else {
        await postJson("/api/templates", {
          name: createName.trim(),
          adapterId: "browser_form",
          config: defaultBrowserFormTemplateConfig,
        });
      }
      setCreateOpen(false);
      notify("模板已创建");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "模板创建失败");
    } finally {
      setCreating(false);
    }
  };

  const edit = async (item: ExecutionTemplate) => {
    const name = window.prompt("模板名称", item.name);
    if (!name?.trim()) return;
    let config = item.config;
    if (item.adapterId === "http_flow") {
      const source = window.prompt("编辑 HTTP 流程步骤 JSON", JSON.stringify(item.config, null, 2));
      if (!source) return;
      try { config = JSON.parse(source); } catch { notify("JSON 格式无效"); return; }
    }
    await putJson(`/api/templates/${item.id}`, { name, adapterId: item.adapterId, config });
    if (item.adapterId === "http_flow" && window.confirm("立即完整测试该 HTTP 流程并标记为可用于任务？")) {
      const variableText = window.prompt("普通变量 JSON", "{}") || "{}";
      const secretText = window.prompt("秘密变量 JSON（仅用于本次测试，不保存）", "{}") || "{}";
      await postJson(`/api/templates/${item.id}/http-test`, {
        variables: JSON.parse(variableText), secrets: JSON.parse(secretText),
      });
      notify("HTTP 流程测试通过");
    }
    notify(item.adapterId === "http_flow" ? "HTTP 流程已更新" : "模板已重命名"); await load();
  };
  const copy = async (item: ExecutionTemplate) => {
    await postJson(`/api/templates/${item.id}/copy`, {}); notify("已复制为可复用的用户模板"); await load();
  };
  const remove = async (item: ExecutionTemplate) => {
    if (!window.confirm(`删除模板“${item.name}”吗？`)) return;
    await api(`/api/templates/${item.id}`, { method: "DELETE" }); await load();
  };
  const exportTemplate = async (item: ExecutionTemplate) => {
    const data = await api(`/api/templates/${item.id}/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${item.name}.json`; link.click();
    URL.revokeObjectURL(url);
  };
  const submitTemplate = async (item: ExecutionTemplate) => {
    const description = window.prompt("共享模板说明", item.description || "") ?? "";
    try {
      await postJson(`/api/templates/${item.id}/submit`, { name: item.name, description });
      notify("模板已提交审核");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "提交失败"); }
  };
  const presets = items.filter((item) => item.isPreset);
  const sharedTemplates = items.filter((item) => item.isShared);
  const userTemplates = items.filter((item) => !item.isPreset && !item.isShared);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><h1>执行模板</h1></div>
        <button className="button button-primary" onClick={openCreate}><Plus size={18} />新建模板</button>
      </div>

      <nav className="template-category-nav" aria-label="模板分类">
        {([
          ["preset", presets.length],
          ["shared", sharedTemplates.length],
          ["mine", userTemplates.length],
          ["submissions", submissions.length],
        ] as const).map(([id, count]) => {
          const copy = templateCategoryCopy[id];
          return (
            <button type="button" key={id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>
              <span className="template-category-count">{count}</span>
              <span>
                <strong>{copy.label}</strong>
                <small>{copy.description}</small>
              </span>
            </button>
          );
        })}
      </nav>

      {activeTab === "preset" ? <TemplateSection
        title={templateCategoryCopy.preset.title}
        description="系统维护的只读模板。保存任务后会自动生成任务专用副本，原始预置保持稳定。"
        items={presets}
        onCopy={copy}
        onExport={exportTemplate}
      /> : null}
      {activeTab === "shared" ? <TemplateSection
        title={templateCategoryCopy.shared.title}
        description="由用户投稿并经管理员审核发布。复制或用于任务时不会改动共享源模板。"
        items={sharedTemplates}
        onCopy={copy}
        onExport={exportTemplate}
      /> : null}
      {activeTab === "mine" ? <TemplateSection
        title={templateCategoryCopy.mine.title}
        description="包含手动创建、复制得到的可复用模板，以及任务自动生成的专用模板。"
        items={userTemplates}
        onEdit={edit}
        onCopy={copy}
        onExport={exportTemplate}
        onRemove={remove}
        onSubmit={submitTemplate}
      /> : null}
      {activeTab === "submissions" ? <section className="panel template-section">
        <div className="template-section-heading">
          <div><h2>{templateCategoryCopy.submissions.title}</h2><p>投稿记录只展示审核进度，不影响我的模板。</p></div><span>{submissions.length} 个</span>
        </div>
        <div className="template-list">
          {submissions.length ? submissions.map((item) => (
            <article className="template-list-item submission-list-item" key={item.id}>
              <div className="template-item-main">
                <div className="template-item-title">
                  <strong>{item.name}</strong>
                  <span className={`template-status-chip ${item.status}`}>{submissionStatus(item.status)}</span>
                </div>
                <p>{item.reviewNote || "等待审核结果。"}</p>
              </div>
            </article>
          )) : <div className="empty-state">暂无模板投稿</div>}
        </div>
      </section> : null}

      {createOpen ? (
        <div className="modal-backdrop">
          <section className={`modal ${createSource === "har" ? "modal-har-import" : ""}`} role="dialog" aria-modal="true" aria-labelledby="create-template-title">
            <div className="modal-header"><h2 id="create-template-title">新建执行模板</h2><button type="button" className="icon-button" aria-label="关闭" onClick={() => setCreateOpen(false)}><X size={22} /></button></div>
            <div className="creation-source-tabs" role="tablist" aria-label="模板创建方式">
              <button type="button" role="tab" aria-selected={createSource === "manual"} className={createSource === "manual" ? "selected" : ""} onClick={() => setCreateSource("manual")}>
                <Plus size={18} />手动创建
              </button>
              {capabilities.importHar ? <button type="button" role="tab" aria-selected={createSource === "har"} className={createSource === "har" ? "selected" : ""} onClick={() => setCreateSource("har")}>
                <FileUp size={18} />HAR 导入
              </button> : null}
            </div>
            {createSource === "manual" ? (
              <form onSubmit={create}>
              <div className="modal-body template-create-form">
                <label><span>模板名称</span><input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={100} placeholder="例如：论坛网页登录" required /></label>
                <fieldset className="template-kind"><legend>执行方式</legend><div className="template-kind-grid"><button type="button" className={createAdapter === "browser_form" ? "selected" : ""} aria-pressed={createAdapter === "browser_form"} onClick={() => setCreateAdapter("browser_form")}><Globe2 size={22} /><strong>网页登录</strong><span>自动识别登录表单与签到按钮</span></button>{capabilities.useHttpFlow ? <button type="button" className={createAdapter === "http_flow" ? "selected" : ""} aria-pressed={createAdapter === "http_flow"} onClick={() => setCreateAdapter("http_flow")}><Workflow size={22} /><strong>HTTP 流程</strong><span>按顺序执行接口请求与断言</span></button> : null}</div></fieldset>
                {createAdapter === "http_flow" ? <label><span>首个请求 URL</span><input type="url" value={firstUrl} onChange={(event) => setFirstUrl(event.target.value)} placeholder="https://example.com/api/checkin" required /><small>创建后还需编辑步骤并完整测试，测试通过前不能用于任务。</small></label> : <div className="inline-info">创建后，在任务页面选择该模板并填写站点地址与账号即可。</div>}
              </div>
              <div className="modal-footer"><span /><div className="modal-footer-actions"><button type="button" className="button button-neutral" onClick={() => setCreateOpen(false)}>取消</button><button type="submit" className="button button-primary" disabled={creating}>{creating ? "创建中…" : "创建模板"}</button></div></div>
              </form>
            ) : (
              <div className="modal-body har-import-modal-body">
                <HarImportWorkflow
                  notify={notify}
                  onCreated={async () => {
                    setCreateOpen(false);
                    await load();
                  }}
                />
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function TemplateSection({
  title,
  description,
  items,
  onEdit,
  onCopy,
  onExport,
  onRemove,
  onSubmit,
}: {
  title: string;
  description: string;
  items: ExecutionTemplate[];
  onEdit?: (item: ExecutionTemplate) => Promise<void>;
  onCopy: (item: ExecutionTemplate) => Promise<void>;
  onExport: (item: ExecutionTemplate) => Promise<void>;
  onRemove?: (item: ExecutionTemplate) => Promise<void>;
  onSubmit?: (item: ExecutionTemplate) => Promise<void>;
}) {
  return <section className="panel template-section">
    <div className="template-section-heading"><div><h2>{title}</h2><p>{description}</p></div><span>{items.length} 个</span></div>
    <div className="template-list">
      {items.map((item) => <article className="template-list-item" key={item.id}>
        <div className="template-item-main">
          <div className="template-item-title">
            <strong>{item.name}</strong>
            <span className="template-type-chip">{adapterNames[item.adapterId]}</span>
            {item.adapterId === "http_flow" ? <span className={`template-status-chip ${item.testedAt ? "tested" : "untested"}`}>{item.testedAt ? "已测试" : "待测试"}</span> : null}
          </div>
          <p>{item.description || templateFallbackDescription(item)}</p>
        </div>
        <dl className="template-item-meta">
          <div><dt>维护</dt><dd>{templateMaintenanceLabel(item)}</dd></div>
          <div><dt>更新</dt><dd>{item.isPreset ? "随系统" : formatTemplateDate(item.updatedAt)}</dd></div>
        </dl>
        <div className="row-actions template-item-actions">
          {onEdit ? <button className="button button-neutral button-small" onClick={() => void onEdit(item)}><Pencil size={16} />{item.adapterId === "http_flow" ? "编辑流程" : "重命名"}</button> : null}
          <button className="button button-neutral button-small" onClick={() => void onCopy(item)}><Copy size={16} />{item.isPreset ? "复制为模板" : "复制"}</button>
          <button className="button button-neutral button-small" onClick={() => void onExport(item)}><Download size={16} />导出</button>
          {onSubmit && item.adapterId === "browser_form" ? <button className="button button-neutral button-small" onClick={() => void onSubmit(item)}><Send size={16} />提交审核</button> : null}
          {onRemove ? <button className="button button-danger button-small" onClick={() => void onRemove(item)}><Trash2 size={16} />删除</button> : null}
        </div>
      </article>)}
      {items.length === 0 ? <div className="empty-state">暂无{title}。</div> : null}
    </div>
  </section>;
}

function submissionStatus(status: string): string {
  return ({ pending: "待审核", approved: "已发布", rejected: "已驳回", withdrawn: "已撤回" } as Record<string, string>)[status] || status;
}

function formatTemplateDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function templateMaintenanceLabel(item: ExecutionTemplate): string {
  if (item.isPreset) return "系统内置 · 只读";
  if (item.isShared) return "审核发布 · 只读";
  if (item.isPrivate) return "任务专用";
  return "用户维护 · 可复用";
}

function templateFallbackDescription(item: ExecutionTemplate): string {
  if (item.isPreset) return "适合作为新任务的起点，复制后可按站点调整。";
  if (item.isShared) return "来自共享区，适合复制后复用。";
  if (item.isPrivate) return "由任务保存时自动生成，跟随对应任务维护。";
  return "可在任务中复用，也可提交为共享模板。";
}
