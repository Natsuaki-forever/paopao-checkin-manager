import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ExecutionLimits {
  maxResponseBytes: number;
  maxRedirects: number;
  stepTimeoutMs: number;
  totalTimeoutMs: number;
}

export const defaultExecutionLimits: Readonly<ExecutionLimits> = Object.freeze({
  maxResponseBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
  stepTimeoutMs: 30_000,
  totalTimeoutMs: 5 * 60_000,
});

type Address = { address: string; family: number };
export type HostResolver = (hostname: string) => Promise<Address[]>;

const metadataHosts = new Set([
  "metadata.google.internal",
  "metadata.google.internal.",
  "instance-data.ec2.internal",
  "metadata.azure.internal",
]);

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 2 || b === 88 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) || a >= 224;
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0] || "";
  const mapped = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return blockedIpv4(mapped);
  if (normalized.startsWith("::ffff:")) return true;
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? blockedIpv4(address) : family === 6 ? blockedIpv6(address) : true;
}

const systemResolver: HostResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function assertSafeUrl(
  input: string | URL,
  resolver: HostResolver = systemResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP or HTTPS URLs are allowed");
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Local addresses are not allowed");
  }
  if (metadataHosts.has(hostname)) throw new Error("Cloud metadata addresses are not allowed");
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error("Private or reserved addresses are not allowed");
    return url;
  }
  const addresses = await resolver(hostname);
  if (addresses.length === 0) throw new Error("Target hostname has no address");
  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("Target hostname resolves to a private or reserved address");
  }
  return url;
}

export interface SafeFetchResult {
  response: Response;
  body: Uint8Array;
  finalUrl: string;
  redirects: number;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export async function fetchWithSafety(
  input: string | URL,
  init: RequestInit = {},
  limits: ExecutionLimits = defaultExecutionLimits,
  resolver: HostResolver = systemResolver,
  fetcher: typeof fetch = fetch,
): Promise<SafeFetchResult> {
  const startedAt = Date.now();
  let current = (await assertSafeUrl(input, resolver)).toString();
  let redirects = 0;
  while (true) {
    const remaining = limits.totalTimeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error("HTTP flow total timeout exceeded");
    const response = await fetcher(current, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.any([
        AbortSignal.timeout(Math.min(limits.stepTimeoutMs, remaining)),
        ...(init.signal ? [init.signal] : []),
      ]),
    });
    if (redirectStatuses.has(response.status)) {
      if (redirects >= limits.maxRedirects) throw new Error("HTTP redirect limit exceeded");
      const location = response.headers.get("location");
      if (!location) throw new Error("HTTP redirect is missing Location");
      current = (await assertSafeUrl(new URL(location, current), resolver)).toString();
      redirects += 1;
      continue;
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > limits.maxResponseBytes) {
      await response.body?.cancel();
      throw new Error("HTTP response body limit exceeded");
    }
    const body = await readLimitedBody(response, limits.maxResponseBytes);
    return { response, body, finalUrl: current, redirects };
  }
}

async function readLimitedBody(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error("HTTP response body limit exceeded");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

interface BrowserRequest {
  isNavigationRequest(): boolean;
  frame(): { parentFrame(): unknown };
  url(): string;
}
interface BrowserRoute {
  request(): BrowserRequest;
  continue(): Promise<unknown>;
  abort(code?: string): Promise<unknown>;
}
interface BrowserContextLike {
  route(pattern: string, handler: (route: BrowserRoute) => Promise<void>): Promise<unknown>;
  unroute(pattern: string, handler: (route: BrowserRoute) => Promise<void>): Promise<unknown>;
}

export async function installBrowserMainDocumentGuard(
  context: BrowserContextLike,
  resolver: HostResolver = systemResolver,
): Promise<() => Promise<void>> {
  const handler = async (route: BrowserRoute): Promise<void> => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame().parentFrame()) {
      await route.continue();
      return;
    }
    try {
      await assertSafeUrl(request.url(), resolver);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  };
  await context.route("**/*", handler);
  return async () => { await context.unroute("**/*", handler); };
}
