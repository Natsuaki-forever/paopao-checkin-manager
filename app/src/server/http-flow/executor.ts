import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { HttpFlowExtraction, HttpFlowTemplateV1 } from "../../shared/types.js";
import { assertSafeProxyUrl, defaultExecutionLimits, fetchWithSafety, type ExecutionLimits, type HostResolver } from "../security/network.js";
import { redactSensitive, redactText, redactUrl } from "../security/redaction.js";

export interface HttpFlowResult {
  variables: Record<string, string>;
  secretVariables: string[];
  cookies: Record<string, string>;
  summaries: Array<{ stepId: string; status: number; finalUrl: string; extracted: string[] }>;
}
const variablePattern = /{{([A-Za-z_][A-Za-z0-9_]*)}}/g;
const interpolate = (value: string, variables: Record<string, string>) =>
  value.replace(variablePattern, (_match, name: string) => {
    if (!(name in variables)) throw new Error(`Missing variable: ${name}`);
    return variables[name]!;
  });

export async function executeHttpFlow(
  template: HttpFlowTemplateV1,
  input: { variables?: Record<string, string>; secrets?: Record<string, string>; cookies?: Record<string, string>; proxy?: string; resolver?: HostResolver; shouldCancel?: () => boolean },
  limits: ExecutionLimits = defaultExecutionLimits,
  onlyStepId?: string,
): Promise<HttpFlowResult> {
  const variables = { ...(input.variables || {}), ...(input.secrets || {}) };
  const secretVariables = new Set(Object.keys(input.secrets || {}));
  const cookies = { ...(input.cookies || {}) };
  const summaries: HttpFlowResult["summaries"] = [];
  const started = Date.now();
  if (input.proxy) await assertSafeProxyUrl(input.proxy, input.resolver);
  const dispatcher = input.proxy ? new ProxyAgent(input.proxy) : undefined;
  try {
    for (const step of template.steps) {
      if (onlyStepId && step.id !== onlyStepId) continue;
      if (input.shouldCancel?.()) {
        throw Object.assign(new Error("任务已由管理员停止"), { status: "cancelled", retryable: false });
      }
      const url = new URL(interpolate(step.url, variables));
      for (const [key, value] of Object.entries(step.query || {})) url.searchParams.set(key, interpolate(value, variables));
      const headers = Object.fromEntries(Object.entries(step.headers || {}).map(([k, v]) => [k, interpolate(v, variables)]));
      if (Object.keys(cookies).length) headers.cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
      const remaining = limits.totalTimeoutMs - (Date.now() - started);
      if (remaining <= 0) throw new Error("HTTP flow total timeout exceeded");
      const result = await fetchWithSafety(url, {
        method: step.method, headers, body: step.body === undefined ? undefined : interpolate(step.body, variables),
      }, { ...limits, totalTimeoutMs: remaining }, input.resolver, dispatcher
        ? ((target, init) => undiciFetch(String(target), { ...init, dispatcher } as never) as never)
        : undefined);
      const text = new TextDecoder().decode(result.body);
      absorbCookies(result.response.headers, cookies);
      assertStep(step.assertions, result.response.status, text);
      const extracted: string[] = [];
      for (const rule of step.extracts || []) {
        const value = extract(rule, text, result.response.headers, cookies);
        variables[rule.variable] = value;
        if (rule.secret) secretVariables.add(rule.variable);
        extracted.push(rule.variable);
      }
      summaries.push({ stepId: step.id, status: result.response.status, finalUrl: redactUrl(result.finalUrl), extracted });
    }
  } finally {
    await dispatcher?.close();
  }
  const safeVariables = redactSensitive(Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, secretVariables.has(k) ? "[REDACTED]" : redactText(v)])));
  return { variables: safeVariables, secretVariables: [...secretVariables], cookies, summaries };
}

function assertStep(assertions: HttpFlowTemplateV1["steps"][number]["assertions"], status: number, text: string) {
  if (assertions?.status && !assertions.status.includes(status)) throw new Error(`Unexpected HTTP status: ${status}`);
  for (const value of assertions?.includes || []) if (!text.includes(value)) throw new Error(`Response does not include: ${value}`);
  for (const value of assertions?.excludes || []) if (text.includes(value)) throw new Error(`Response includes forbidden text: ${value}`);
}
function absorbCookies(headers: Headers, jar: Record<string, string>) {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
  for (const line of values) { const pair = line.split(";", 1)[0] || ""; const at = pair.indexOf("="); if (at > 0) jar[pair.slice(0, at)] = pair.slice(at + 1); }
}
function extract(rule: HttpFlowExtraction, text: string, headers: Headers, cookies: Record<string, string>): string {
  if (rule.source === "header") return headers.get(rule.expression) || fail(rule);
  if (rule.source === "cookie") return cookies[rule.expression] || fail(rule);
  if (rule.source === "jsonpath") {
    if (!/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])+$/.test(rule.expression)) return fail(rule);
    let value: unknown = JSON.parse(text);
    for (const part of rule.expression.slice(1).match(/\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) || []) value = part[0] === "." ? (value as Record<string, unknown>)[part.slice(1)] : (value as unknown[])[Number(part.slice(1, -1))];
    return value == null ? fail(rule) : String(value);
  }
  if (rule.expression.length > 300 || /\(\?[=!<]|\\[1-9]/.test(rule.expression)) return fail(rule);
  const match = new RegExp(rule.expression).exec(text);
  return match?.[1] ?? match?.[0] ?? fail(rule);
}
function fail(rule: HttpFlowExtraction): never { throw new Error(`Extraction failed: ${rule.variable}`); }
