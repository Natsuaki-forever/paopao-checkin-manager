import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildServerChanPayload,
  buildWechatPayload,
} from "../src/notifier.js";

const failure = {
  status: "challenge" as const,
  message: "检测到人机验证",
  startedAt: "2026-06-18T00:00:00.000Z",
  finishedAt: "2026-06-18T00:00:01.000Z",
  attempt: 1,
};

describe("notification payloads", () => {
  it("builds failure content", () => {
    const payload = buildWechatPayload(
      failure,
      "https://example.com/checkin",
    ) as { markdown: { content: string } };
    assert.match(payload.markdown.content, /自动签到失败/);
    assert.match(payload.markdown.content, /检测到人机验证/);
  });

  it("does not include screenshot paths", () => {
    const payload = buildServerChanPayload(
      { ...failure, screenshot: "/secret/path.png" },
      "https://example.com/checkin",
    );
    assert.doesNotMatch(payload.toString(), /secret/);
  });

  it("builds success titles for both channels", () => {
    const success = {
      ...failure,
      status: "success" as const,
      message: "签到成功",
    };
    const wechat = buildWechatPayload(success, "https://example.com") as {
      markdown: { content: string };
    };
    const serverChan = buildServerChanPayload(
      success,
      "https://example.com",
    );
    assert.match(wechat.markdown.content, /自动签到成功/);
    assert.equal(serverChan.get("title"), "自动签到成功");
  });
});
