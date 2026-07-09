import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthRequiredError,
  RetryableCheckinError,
} from "../src/errors.js";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  it("retries transient failures", async () => {
    let calls = 0;
    const operation = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new RetryableCheckinError("timeout");
      return "ok";
    };

    assert.equal(await withRetry(operation, 2, 0), "ok");
    assert.equal(calls, 2);
  });

  it("does not retry authentication failures", async () => {
    let calls = 0;
    const operation = async (): Promise<never> => {
      calls += 1;
      throw new AuthRequiredError();
    };
    await assert.rejects(
      () => withRetry(operation, 2, 0),
      AuthRequiredError,
    );
    assert.equal(calls, 1);
  });
});
