import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../src/server/adapters/registry.js";
import type { CheckinAdapter } from "../src/server/adapters/types.js";

const adapter: CheckinAdapter = {
  templateId: "browser_form",
  async run(_task, _credentials, _settings, attempt) {
    return {
      status: "success",
      message: "ok",
      startedAt: "2026-06-30T00:00:00.000Z",
      finishedAt: "2026-06-30T00:00:01.000Z",
      attempt,
    };
  },
};

describe("adapter registry", () => {
  it("resolves registered templates and rejects duplicates", () => {
    const registry = new AdapterRegistry([adapter]);
    expect(registry.has("browser_form")).toBe(true);
    expect(registry.get("browser_form")).toBe(adapter);
    expect(() => registry.register(adapter)).toThrow(/已注册/);
  });
});