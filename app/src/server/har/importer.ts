import type { HttpFlowStep, HttpFlowTemplateV1 } from "../../shared/types.js";

interface HarEntry {
  request?: {
    method?: string; url?: string;
    headers?: Array<{ name?: string; value?: string }>;
    queryString?: Array<{ name?: string; value?: string }>;
    postData?: { mimeType?: string; text?: string; params?: Array<{ name?: string; value?: string }> };
  };
  response?: { content?: { mimeType?: string; text?: string }; headers?: Array<{ name?: string; value?: string }> };
}
export interface HarPreviewItem {
  index: number; method: string; url: string; selected: boolean; reason?: string;
}
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const secretName = /pass(?:word)?|secret|token|authorization|cookie|api[-_]?key/i;
const staticType = /image|font|audio|video|javascript|css/i;
const staticPath = /\.(?:png|jpe?g|gif|svg|webp|woff2?|ttf|css|js|map)(?:\?|$)/i;
const tracking = /google-analytics|doubleclick|clarity\.ms|sentry|segment\.io/i;

export function readHarEntries(value: unknown): HarEntry[] {
  if (!value || typeof value !== "object") throw new Error("HAR JSON 格式无效");
  const entries = (value as { log?: { entries?: unknown } }).log?.entries;
  if (!Array.isArray(entries) || entries.length > 2_000) throw new Error("HAR entries 无效或数量过多");
  return entries as HarEntry[];
}

export function previewHar(value: unknown): HarPreviewItem[] {
  return readHarEntries(value).map((entry, index) => {
    const method = entry.request?.method?.toUpperCase() || "GET";
    const url = entry.request?.url || "";
    const mime = entry.response?.content?.mimeType || "";
    const filtered = !methods.has(method) || !/^https?:\/\//i.test(url) || staticType.test(mime) || staticPath.test(url) || tracking.test(url);
    return { index, method, url, selected: !filtered, reason: filtered ? "静态、统计或不支持的请求" : undefined };
  });
}

export function convertHar(value: unknown, selected: number[]): {
  template: HttpFlowTemplateV1;
  variables: Record<string, string>;
  secretVariables: string[];
  suggestions: Array<{ stepId: string; message: string }>;
} {
  const entries = readHarEntries(value);
  const variables: Record<string, string> = {};
  const secrets = new Set<string>();
  const suggestions: Array<{ stepId: string; message: string }> = [];
  const steps: HttpFlowStep[] = [];
  for (const index of selected) {
    const entry = entries[index];
    if (!entry?.request?.url) throw new Error(`HAR 请求不存在：${index}`);
    const method = entry.request.method?.toUpperCase() || "GET";
    if (!methods.has(method)) throw new Error(`不支持的 HTTP 方法：${method}`);
    const stepId = `har-${index + 1}`;
    const headers: Record<string, string> = {};
    for (const header of entry.request.headers || []) {
      if (!header.name || header.value === undefined) continue;
      if (secretName.test(header.name)) {
        const variable = safeVariable(header.name);
        secrets.add(variable);
        headers[header.name] = `{{${variable}}}`;
      } else if (!/^content-length$/i.test(header.name)) headers[header.name] = header.value;
    }
    let body = entry.request.postData?.text;
    for (const parameter of entry.request.postData?.params || []) {
      if (!parameter.name || parameter.value === undefined || !secretName.test(parameter.name)) continue;
      const variable = safeVariable(parameter.name);
      secrets.add(variable);
      if (body) body = body.replaceAll(parameter.value, `{{${variable}}}`);
    }
    const responseHeaders = entry.response?.headers || [];
    if (responseHeaders.some((header) => /csrf|xsrf|token/i.test(header.name || ""))) {
      suggestions.push({ stepId, message: "检测到可能的 CSRF/Token 响应头，请人工确认提取规则" });
    }
    steps.push({
      id: stepId,
      name: `${method} ${new URL(entry.request.url).pathname}`,
      method: method as HttpFlowStep["method"],
      url: entry.request.url,
      headers: Object.keys(headers).length ? headers : undefined,
      body,
      assertions: { status: [200, 201, 202, 204] },
    });
  }
  if (!steps.length) throw new Error("请至少选择一个请求");
  return { template: { version: 1, kind: "http_flow", steps }, variables, secretVariables: [...secrets], suggestions };
}

function safeVariable(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^([^a-z_])/, "_$1").slice(0, 64);
}
