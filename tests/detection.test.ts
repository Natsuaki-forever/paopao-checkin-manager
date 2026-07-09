import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textPattern } from "../src/detection.js";

describe("textPattern", () => {
  it("matches exact button text without matching longer labels", () => {
    const pattern = textPattern(["签到", "立即签到"], true);
    assert.equal(pattern.test("签到"), true);
    assert.equal(pattern.test("立即签到"), true);
    assert.equal(pattern.test("签到设置"), false);
  });

  it("escapes regular expression characters", () => {
    const pattern = textPattern(["签到(每日)"], true);
    assert.equal(pattern.test("签到(每日)"), true);
  });
});
