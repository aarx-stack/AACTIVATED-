/**
 * Encryption at rest for stored credentials (OAuth tokens). AES-256-GCM with a key from
 * TOKEN_ENCRYPTION_KEY (32 random bytes, base64). Node's built-in crypto only.
 *
 * Format: "v1.<iv>.<tag>.<ciphertext>" (base64url). The tag makes tampering detectable.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyError";
  }
}

/** Reads and checks the key. Throws a readable error, never the key itself. */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) throw new SecretKeyError("TOKEN_ENCRYPTION_KEY is not set.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new SecretKeyError(
      "TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32).",
    );
  }
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new SecretKeyError("Stored credential is not in a recognised format.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretKeyError(
      "Stored credential could not be decrypted. The encryption key may have changed; reconnect.",
    );
  }
}
