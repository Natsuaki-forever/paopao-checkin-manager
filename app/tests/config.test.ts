import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAppConfig } from "../src/server/config.js";

afterEach(() => vi.unstubAllEnvs());

describe("feature flags", () => {
  it("keeps queue, session and HTTP flow disabled by default", () => {
    vi.stubEnv("CHECKIN_FEATURE_QUEUE", "");
    vi.stubEnv("CHECKIN_FEATURE_SESSION", "");
    vi.stubEnv("CHECKIN_FEATURE_HTTP_FLOW", "");
    expect(loadAppConfig().features).toEqual({ queue: false, session: false, httpFlow: false });
  });

  it("only enables explicitly selected rollout features", () => {
    vi.stubEnv("CHECKIN_FEATURE_QUEUE", "true");
    vi.stubEnv("CHECKIN_FEATURE_SESSION", "0");
    vi.stubEnv("CHECKIN_FEATURE_HTTP_FLOW", "yes");
    expect(loadAppConfig().features).toEqual({ queue: true, session: false, httpFlow: true });
  });

  it("keeps public registration off in production unless explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHECKIN_ALLOW_REGISTRATION", "");
    expect(loadAppConfig().registrationEnabled).toBe(false);

    vi.stubEnv("CHECKIN_ALLOW_REGISTRATION", "true");
    expect(loadAppConfig().registrationEnabled).toBe(true);
  });

  it("enables registration in local simulation mode", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHECKIN_ALLOW_REGISTRATION", "");
    expect(loadAppConfig().registrationEnabled).toBe(true);
  });

  it("uses an externally mounted secret key when configured", () => {
    vi.stubEnv("CHECKIN_MANAGER_SECRET_PATH", "/run/secrets/paopao-secret.key");
    expect(loadAppConfig().secretPath).toBe("/run/secrets/paopao-secret.key");
  });
});
