import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpFlowTemplateV1 } from "../src/shared/types.js";
import { executeHttpFlow } from "../src/server/http-flow/executor.js";
import { httpFlowTemplateSchema } from "../src/server/http-flow/schema.js";

afterEach(() => vi.unstubAllGlobals());

const flow: HttpFlowTemplateV1 = {
  version: 1,
  kind: "http_flow",
  steps: [
    {
      id: "login", name: "Login", method: "POST", url: "https://flow.test/login",
      headers: { "content-type": "application/json" },
      body: '{"username":"{{username}}","password":"{{password}}"}',
      assertions: { status: [200] },
      extracts: [{ variable: "csrf", source: "jsonpath", expression: "$.data.csrf", secret: true }],
    },
    {
      id: "checkin", name: "Check in", method: "GET", url: "https://flow.test/checkin",
      query: { token: "{{csrf}}" },
      assertions: { status: [200], includes: ["checked"], excludes: ["failed"] },
      extracts: [{ variable: "result", source: "regex", expression: "(checked)" }],
    },
  ],
};

describe("HTTP flow executor", () => {
  it("runs a two-step login flow with variables, cookies, assertions and extraction", async () => {
    const mocked = vi.fn()
      .mockResolvedValueOnce(new Response('{"data":{"csrf":"csrf-secret"}}', {
        status: 200, headers: { "content-type": "application/json", "set-cookie": "sid=cookie-secret; Path=/; HttpOnly" },
      }))
      .mockImplementationOnce((url: string, init: RequestInit) => {
        expect(url).toContain("token=csrf-secret");
        expect((init.headers as Record<string, string>).cookie).toContain("sid=cookie-secret");
        return Promise.resolve(new Response("checked", { status: 200 }));
      });
    vi.stubGlobal("fetch", mocked);
    const result = await executeHttpFlow(flow, {
      variables: { username: "alice" }, secrets: { password: "password-secret" },
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(result.summaries).toHaveLength(2);
    expect(result.variables).toMatchObject({ username: "[REDACTED]", password: "[REDACTED]", csrf: "[REDACTED]", result: "checked" });
    expect(JSON.stringify(result.summaries)).not.toContain("csrf-secret");
    expect(result.cookies.sid).toBe("cookie-secret");
  });

  it("supports single-step testing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("checked", { status: 200 })));
    const result = await executeHttpFlow(flow, { variables: { csrf: "token" }, resolver: async () => [{ address: "93.184.216.34", family: 4 }] }, undefined, "checkin");
    expect(result.summaries.map((item) => item.stepId)).toEqual(["checkin"]);
  });

  it("rejects executable or unknown schema fields", () => {
    expect(() => httpFlowTemplateSchema.parse({ ...flow, eval: "process.exit()" })).toThrow();
  });
});
