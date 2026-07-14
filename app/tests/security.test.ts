import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeProxyUrl, assertSafeUrl, fetchWithSafety, installBrowserRequestGuard, isBlockedAddress } from "../src/server/security/network.js";
import { redactSensitive, redactText, redactUrl } from "../src/server/security/redaction.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

afterEach(() => vi.unstubAllGlobals());

describe("network safety", () => {
  it("rejects local, private and cloud metadata destinations", async () => {
    await expect(assertSafeUrl("http://localhost/test")).rejects.toThrow(/HTTPS/i);
    await expect(assertSafeUrl("https://169.254.169.254/latest/meta-data"))
      .rejects.toThrow(/private|reserved/i);
    await expect(assertSafeUrl("https://public.test", async () => [
      { address: "10.0.0.8", family: 4 },
    ])).rejects.toThrow(/resolves/i);
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    await expect(assertSafeUrl("https://[::1]/")).rejects.toThrow(/private|reserved/i);
    await expect(assertSafeUrl("https://[::ffff:127.0.0.1]/")).rejects.toThrow(/private|reserved/i);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
  });

  it("validates every redirect and returns a bounded body", async () => {
    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/done" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockedFetch);
    const result = await fetchWithSafety("https://public.test/start", {}, {
      maxResponseBytes: 10,
      maxRedirects: 2,
      stepTimeoutMs: 1000,
      totalTimeoutMs: 2000,
    }, publicResolver);
    expect(new TextDecoder().decode(result.body)).toBe("ok");
    expect(result).toMatchObject({ finalUrl: "https://public.test/done", redirects: 1 });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("blocks an unsafe redirect before requesting it", async () => {
    const mockedFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://127.0.0.1/admin" } }),
    );
    vi.stubGlobal("fetch", mockedFetch);
    await expect(fetchWithSafety("https://public.test", {}, {
      maxResponseBytes: 10,
      maxRedirects: 2,
      stepTimeoutMs: 1000,
      totalTimeoutMs: 2000,
    }, publicResolver)).rejects.toThrow(/private|reserved/i);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("aborts unsafe browser requests, including subresources", async () => {
    type RouteHandler = (route: any) => Promise<void>;
    let handler: RouteHandler | undefined;
    const context = {
      route: async (_pattern: string, next: RouteHandler) => { handler = next; },
      unroute: vi.fn(async () => undefined),
    };
    const stop = await installBrowserRequestGuard(context);
    const abort = vi.fn(async () => undefined);
    const proceed = vi.fn(async () => undefined);
    await handler!({
      request: () => ({
        url: () => "https://127.0.0.1/admin",
      }),
      continue: proceed,
      abort,
    });
    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(proceed).not.toHaveBeenCalled();
    await stop();
    expect(context.unroute).toHaveBeenCalled();
  });

  it("allows only public proxies plus the explicitly trusted internal proxy host", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(assertSafeProxyUrl("http://127.0.0.1:7890")).rejects.toThrow(/private|reserved/i);
    await expect(assertSafeProxyUrl("http://private-proxy:7890", async () => [
      { address: "10.0.0.8", family: 4 },
    ])).rejects.toThrow(/resolves/i);
    await expect(assertSafeProxyUrl("http://mihomo:7890", async () => [
      { address: "10.0.0.8", family: 4 },
    ])).resolves.toMatchObject({ hostname: "mihomo" });
    await expect(assertSafeProxyUrl("https://proxy.example.test", publicResolver))
      .resolves.toMatchObject({ hostname: "proxy.example.test" });
  });
  it("rejects an oversized declared response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("large", { headers: { "content-length": "100" } }),
    ));
    await expect(fetchWithSafety("https://public.test", {}, {
      maxResponseBytes: 5,
      maxRedirects: 0,
      stepTimeoutMs: 1000,
      totalTimeoutMs: 2000,
    }, publicResolver)).rejects.toThrow(/response body/i);
  });
});

describe("redaction", () => {
  it("redacts nested secret fields, text tokens and URL credentials", () => {
    const value = redactSensitive({ password: "secret", nested: { authorization: "Bearer abc" } });
    expect(JSON.stringify(value)).not.toContain("secret");
    expect(JSON.stringify(value)).not.toContain("abc");
    expect(redactText("token=abc123")).not.toContain("abc123");
    const url = redactUrl("https://user:pass@example.com/path?access_token=abc#token=def");
    expect(url).not.toContain("user");
    expect(url).not.toContain("pass");
    expect(url).not.toContain("abc");
    expect(url).not.toContain("def");
  });
});
