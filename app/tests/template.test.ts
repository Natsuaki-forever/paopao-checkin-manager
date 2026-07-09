import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  sampleTemplateData,
  validateTemplate,
} from "../src/server/services/template.js";

describe("notification templates", () => {
  it("renders only supported variables", () => {
    expect(
      renderTemplate("{{siteName}}：{{message}}", sampleTemplateData),
    ).toBe("Lynvx：模拟签到成功，未访问目标网站");
  });

  it("rejects unknown variables", () => {
    expect(() => validateTemplate("{{password}}")).toThrow(/不支持/);
  });
});

