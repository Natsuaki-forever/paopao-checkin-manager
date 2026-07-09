import { FileUp, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { postJson } from "../api";

interface HarItem {
  index: number;
  method: string;
  url: string;
  selected: boolean;
  reason?: string;
}

interface HarImportWorkflowProps {
  notify: (message: string) => void;
  onCreated: () => void | Promise<void>;
}

export function HarImportWorkflow({ notify, onCreated }: HarImportWorkflowProps) {
  const [har, setHar] = useState<unknown>();
  const [items, setItems] = useState<HarItem[]>([]);
  const [fileName, setFileName] = useState("");
  const [templateName, setTemplateName] = useState("HAR 导入流程");
  const [converting, setConverting] = useState(false);

  const choose = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      notify("HAR 文件不能超过 5MB");
      return;
    }
    try {
      const value = JSON.parse(await file.text());
      const preview = await postJson<{ items: HarItem[] }>("/api/har/preview", { har: value });
      setHar(value);
      setItems(preview.items);
      setFileName(file.name);
    } catch (error) {
      notify(error instanceof Error ? error.message : "HAR 解析失败");
    }
  };

  const convert = async () => {
    const selected = items.filter((item) => item.selected && !item.reason).map((item) => item.index);
    if (!har || !selected.length || !templateName.trim()) return;
    setConverting(true);
    try {
      const result = await postJson<{
        template: unknown;
        suggestions: Array<{ message: string }>;
      }>("/api/har/convert", { har, selected });
      await postJson("/api/templates", {
        name: templateName.trim(),
        adapterId: "http_flow",
        source: "har",
        config: result.template,
      });
      notify(result.suggestions.length
        ? `模板已保存；有 ${result.suggestions.length} 条建议需要确认`
        : "模板已保存，完整测试通过后即可用于任务");
      await onCreated();
    } catch (error) {
      notify(error instanceof Error ? error.message : "HAR 转换失败");
    } finally {
      setConverting(false);
    }
  };

  const selectedCount = items.filter((item) => item.selected && !item.reason).length;

  return (
    <div className="har-modal-workflow">
      <div className="security-note">
        <ShieldCheck size={19} />
        <span>HAR 可能包含 Cookie 和授权信息。导入器会移除响应正文，并把识别到的秘密转为秘密变量。</span>
      </div>
      <div className="har-upload-row">
        <label className="button button-primary file-upload" htmlFor="template-har-file">
          <FileUp size={18} />{fileName || "选择 HAR 文件"}
          <input
            id="template-har-file"
            type="file"
            accept=".har,.json,application/json"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </label>
        <span>文件不超过 5MB，选择后先预览，不会直接创建任务。</span>
      </div>

      {items.length ? (
        <>
          <div className="har-modal-table table-scroll">
            <table className="data-table">
              <thead><tr><th>选择</th><th>方法</th><th>URL</th><th>说明</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.index}>
                    <td>
                      <input
                        aria-label={`选择请求 ${item.index + 1}`}
                        type="checkbox"
                        checked={item.selected}
                        disabled={Boolean(item.reason)}
                        onChange={(event) => setItems((all) => all.map((value) =>
                          value.index === item.index ? { ...value, selected: event.target.checked } : value
                        ))}
                      />
                    </td>
                    <td>{item.method}</td>
                    <td className="har-url">{item.url}</td>
                    <td>{item.reason || "候选业务请求"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="har-modal-actions">
            <label>
              <span>模板名称</span>
              <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} maxLength={100} />
            </label>
            <span className="muted">已选择 {selectedCount} 个请求</span>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void convert()}
              disabled={!selectedCount || !templateName.trim() || converting}
            >
              {converting ? "转换中…" : "导入为待测试模板"}
            </button>
          </div>
        </>
      ) : (
        <div className="har-empty har-modal-empty">
          <FileUp size={32} />
          <strong>选择 HAR 文件后预览请求</strong>
          <span>只勾选登录和签到所需的业务请求。</span>
        </div>
      )}
      <details className="har-help">
        <summary>如何取得 HAR 文件</summary>
        <p>在目标网站打开开发者工具的“网络 / Network”，清空旧记录，手动完成一次登录和签到，然后导出 HAR。</p>
      </details>
    </div>
  );
}

