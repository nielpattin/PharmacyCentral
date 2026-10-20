import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { SecretSealer } from "../modules/credentials/credential-store.ts";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT = "v1";
/** Padded base64 of `KEY_BYTES`, the form `openssl rand -base64 32` prints: 44 characters for 32 bytes, one `=`. */
const MASTER_KEY_PADDING = (3 - (KEY_BYTES % 3)) % 3;
const MASTER_KEY_BASE64 = new RegExp(
  `^[A-Za-z0-9+/]{${4 * Math.ceil(KEY_BYTES / 3) - MASTER_KEY_PADDING}}${"=".repeat(MASTER_KEY_PADDING)}$`,
);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const KEY_ERROR = `SECRETS_ENCRYPTION_KEY must be ${KEY_BYTES} bytes encoded as base64.`;

export class SecretBoxError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

/**
 * Seals a secret with AES-256-GCM under the master key. The purpose is bound as additional authenticated data, so a
 * ciphertext copied to another purpose fails to open.
 */
export class SecretBox implements SecretSealer {
  private readonly key: Buffer;

  public constructor(masterKeyBase64: string) {
    // Node's Buffer.from skips invalid characters and accepts missing padding, so the regex runs first.
    if (!MASTER_KEY_BASE64.test(masterKeyBase64)) throw new Error(KEY_ERROR);
    const key = Buffer.from(masterKeyBase64, "base64");
    if (key.length !== KEY_BYTES) throw new Error(KEY_ERROR);
    this.key = key;
  }

  public seal(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [FORMAT, iv, cipher.getAuthTag(), body]
      .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
      .join(".");
  }

  public open(sealed: string, context: string): string {
    const [format, iv, tag, body, ...rest] = sealed.split(".");
    if (
      format !== FORMAT ||
      !iv ||
      !tag ||
      !body ||
      rest.length > 0 ||
      ![iv, tag, body].every((part) => BASE64URL.test(part)) ||
      Buffer.from(iv, "base64url").length !== IV_BYTES
    ) {
      throw new SecretBoxError("The stored secret has an unknown format.");
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretBoxError("The stored secret cannot be decrypted with the current master key.");
    }
  }
}
