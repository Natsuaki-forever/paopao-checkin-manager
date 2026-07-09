import { describe, expect, it } from "vitest";
import { convertHar, previewHar } from "../src/server/har/importer.js";

const har = {
  log: { entries: [
    { request: { method: "GET", url: "https://example.com/app.js" }, response: { content: { mimeType: "application/javascript", text: "large response" } } },
    { request: {
      method: "POST", url: "https://example.com/login",
      headers: [{ name: "Authorization", value: "Bearer secret" }],
      postData: { text: "password=hidden", params: [{ name: "password", value: "hidden" }] },
    }, response: { headers: [{ name: "x-csrf-token", value: "token" }], content: { mimeType: "application/json", text: "must-not-export" } } },
  ] },
};

describe("HAR importer", () => {
  it("filters static resources and requires manual request selection", () => {
    expect(previewHar(har)).toMatchObject([
      { index: 0, selected: false },
      { index: 1, selected: true },
    ]);
  });
  it("converts secrets to variables, omits responses and only suggests token extraction", () => {
    const result = convertHar(har, [1]);
    const serialized = JSON.stringify(result);
    expect(result.secretVariables).toEqual(expect.arrayContaining(["authorization", "password"]));
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("must-not-export");
    expect(result.suggestions[0]?.message).toMatch(/人工确认/);
    expect(result.template.steps[0]?.extracts).toBeUndefined();
  });
});
