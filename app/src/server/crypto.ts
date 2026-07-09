import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const algorithm = "aes-256-gcm";

export async function getOrCreateEncryptionKey(filePath: string): Promise<Buffer> {
  try {
    const stored = (await readFile(filePath, "utf8")).trim();
    const key = Buffer.from(stored, "base64url");
    if (key.length !== 32) throw new Error("本地加密密钥长度无效");
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const key = randomBytes(32);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, key.toString("base64url"), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return key;
  }
}

export function encryptSecret(value: string, key: Buffer, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string, key: Buffer, aad?: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("加密数据格式无效");
  const decipher = createDecipheriv(
    algorithm,
    key,
    Buffer.from(ivText, "base64url"),
  );
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function maskUsername(value: string): string {
  if (value.includes("@")) {
    const [local = "", domain = ""] = value.split("@", 2);
    return `${local.slice(0, 1)}***@${domain}`;
  }
  if (value.length <= 2) return "***";
  return `${value.slice(0, 2)}***`;
}
