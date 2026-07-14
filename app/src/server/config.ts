import path from "node:path";
import { existsSync } from "node:fs";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  secretPath: string;
  isProduction: boolean;
  webRoot: string;
  mode: "simulation" | "production";
  publicOrigin?: string;
  screenshotDir: string;
  legacyModulePath: string;
  registrationEnabled?: boolean;
  features?: FeatureFlags;
}

export interface FeatureFlags {
  queue: boolean;
  session: boolean;
  httpFlow: boolean;
}

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

function currentOrLegacyPath(dataDir: string, currentName: string, legacyName: string): string {
  const currentPath = path.join(dataDir, currentName);
  const legacyPath = path.join(dataDir, legacyName);
  return existsSync(currentPath) || !existsSync(legacyPath) ? currentPath : legacyPath;
}

export function loadAppConfig(cwd = process.cwd()): AppConfig {
  const dataDir = path.resolve(
    process.env.CHECKIN_MANAGER_DATA_DIR?.trim() ||
      process.env.CHECKIN_DEMO_DATA_DIR?.trim() ||
      path.join(cwd, "data"),
  );
  const port = Number.parseInt(
    process.env.CHECKIN_MANAGER_PORT || process.env.CHECKIN_DEMO_PORT || "8787",
    10,
  );
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("CHECKIN_MANAGER_PORT 必须是有效端口");
  }
  return {
    host:
      process.env.CHECKIN_MANAGER_HOST?.trim() ||
      process.env.CHECKIN_DEMO_HOST?.trim() ||
      "127.0.0.1",
    port,
    dataDir,
    databasePath: currentOrLegacyPath(dataDir, "paopao-checkin.sqlite", "checkin-demo.sqlite"),
    secretPath: process.env.CHECKIN_MANAGER_SECRET_PATH?.trim() ||
      currentOrLegacyPath(dataDir, "paopao-secret.key", "demo-secret.key"),
    isProduction: process.env.NODE_ENV === "production",
    webRoot: path.resolve(cwd, "dist", "web"),
    mode:
      process.env.CHECKIN_MODE?.trim().toLowerCase() === "production"
        ? "production"
        : "simulation",
    publicOrigin: process.env.CHECKIN_PUBLIC_ORIGIN?.trim() || undefined,
    screenshotDir: path.join(dataDir, "screenshots"),
    legacyModulePath: path.resolve(
      process.env.LYNVX_LEGACY_MODULE?.trim() ||
        path.join(cwd, "..", "dist", "src", "checkin.js"),
    ),
    registrationEnabled: process.env.NODE_ENV !== "production" ||
      enabled(process.env.CHECKIN_ALLOW_REGISTRATION),
    features: {
      queue: enabled(process.env.CHECKIN_FEATURE_QUEUE),
      session: enabled(process.env.CHECKIN_FEATURE_SESSION),
      httpFlow: enabled(process.env.CHECKIN_FEATURE_HTTP_FLOW),
    },
  };
}
