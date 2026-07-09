import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthPrincipal } from "../fastify.js";
import type { AppDatabase } from "../database.js";
import {
  defaultUserCapabilities,
  defaultUserQuotas,
  type UserCapabilities,
} from "../../shared/types.js";
import { allCapabilities } from "./access.js";
import { createSessionToken, hashToken } from "../crypto.js";

export const sessionCookieName = "paopao_checkin_session";
const legacySessionCookieName = "checkin_demo_session";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function issueSession(
  database: AppDatabase,
  reply: FastifyReply,
  isProduction: boolean,
  principal: Pick<AuthPrincipal, "role" | "displayName"> & { userId?: string } = {
    role: "admin",
    displayName: "\u7ba1\u7406\u5458",
  },
): void {
  const token = createSessionToken();
  const settings = database.getSettings();
  const expiresAt = new Date(
    Date.now() + settings.sessionHours * 60 * 60 * 1_000,
  );
  database.db
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .run(new Date().toISOString());
  database.db
    .prepare(
      `INSERT INTO sessions(
        token_hash, expires_at, created_at, user_id, role, display_name
      ) VALUES(?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hashToken(token),
      expiresAt.toISOString(),
      new Date().toISOString(),
      principal.userId || null,
      principal.role,
      principal.displayName,
    );
  reply.setCookie(sessionCookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
    expires: expiresAt,
  });
}

export function revokeSession(
  database: AppDatabase,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const token = request.cookies[sessionCookieName] || request.cookies[legacySessionCookieName];
  if (token) {
    database.db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }
  reply.clearCookie(sessionCookieName, { path: "/" });
  reply.clearCookie(legacySessionCookieName, { path: "/" });
}

export function isAuthenticated(
  database: AppDatabase,
  request: FastifyRequest,
): boolean {
  return Boolean(getAuthPrincipal(database, request));
}


export function getAuthPrincipal(
  database: AppDatabase,
  request: FastifyRequest,
): AuthPrincipal | undefined {
  const token = request.cookies[sessionCookieName] || request.cookies[legacySessionCookieName];
  if (!token) return undefined;
  const session = database.db
    .prepare(`SELECT s.user_id, COALESCE(u.role, s.role) AS role,
      COALESCE(u.username, s.display_name) AS display_name,
      u.status, u.capabilities_json, u.max_tasks, u.max_enabled_tasks, u.max_daily_actions
      FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`)
    .get(hashToken(token), new Date().toISOString()) as {
      user_id: string | null;
      role: "user" | "admin";
      display_name: string;
      status: "active" | "suspended" | null;
      capabilities_json: string | null;
      max_tasks: number | null;
      max_enabled_tasks: number | null;
      max_daily_actions: number | null;
    } | undefined;
  if (!session || (session.user_id && session.status !== "active")) return undefined;
  if (!session.user_id) {
    return {
      role: "admin",
      displayName: session.display_name,
      owner: true,
      capabilities: allCapabilities,
      quotas: { maxTasks: 1_000_000, maxEnabledTasks: 1_000_000, maxDailyActions: 1_000_000 },
    };
  }
  let capabilities: UserCapabilities = defaultUserCapabilities;
  try {
    capabilities = { ...defaultUserCapabilities, ...JSON.parse(session.capabilities_json || "{}") };
  } catch {
    capabilities = defaultUserCapabilities;
  }
  return {
    role: session.role,
    displayName: session.display_name,
    userId: session.user_id,
    owner: false,
    capabilities: session.role === "admin" ? allCapabilities : capabilities,
    quotas: session.role === "admin" ? {
      maxTasks: 1_000_000,
      maxEnabledTasks: 1_000_000,
      maxDailyActions: 1_000_000,
    } : {
      maxTasks: session.max_tasks ?? defaultUserQuotas.maxTasks,
      maxEnabledTasks: session.max_enabled_tasks ?? defaultUserQuotas.maxEnabledTasks,
      maxDailyActions: session.max_daily_actions ?? defaultUserQuotas.maxDailyActions,
    },
  };
}

export function replacePassword(database: AppDatabase, hash: string): void {
  const timestamp = new Date().toISOString();
  database.db
    .prepare(`INSERT INTO admin_credentials(id, password_hash, created_at, updated_at)
      VALUES(1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash,
        updated_at = excluded.updated_at`)
    .run(hash, timestamp, timestamp);
  database.db.prepare("DELETE FROM sessions").run();
}

export function createAuditId(): string {
  return randomUUID();
}
