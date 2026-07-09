import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  maskUsername,
} from "../src/server/crypto.js";

describe("secret encryption", () => {
  it("round-trips AES-GCM encrypted values", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret("password with spaces", key);
    expect(encrypted).not.toContain("password");
    expect(decryptSecret(encrypted, key)).toBe("password with spaces");
  });

  it("masks usernames without exposing the local part", () => {
    expect(maskUsername("user@example.com")).toBe("u***@example.com");
    expect(maskUsername("demo-user")).toBe("de***");
  });
});

