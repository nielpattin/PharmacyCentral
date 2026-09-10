import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export type Argon2idPasswordPolicy = {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
  saltLength?: number;
};

type DerivedPassword = {
  message: Buffer;
  nonce: Buffer;
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
  type: "argon2id";
};

const derivePassword = promisify(argon2) as (algorithm: "argon2id", parameters: DerivedPassword) => Promise<Buffer>;

const encode = (value: Buffer): string => value.toString("base64url");
const decode = (value: string): Buffer => Buffer.from(value, "base64url");

export class Argon2idPasswordHasher {
  private readonly policy: Required<Argon2idPasswordPolicy>;

  public constructor(policy: Argon2idPasswordPolicy) {
    this.policy = { saltLength: 16, ...policy };
  }

  public async hash(password: string): Promise<string> {
    const salt = randomBytes(this.policy.saltLength);
    const derived = await this.derive(password, salt, this.policy);

    return [
      "$argon2id$v=19",
      `m=${this.policy.memory},t=${this.policy.passes},p=${this.policy.parallelism}`,
      encode(salt),
      encode(derived),
    ].join("$");
  }

  public async verify(password: string, encoded: string): Promise<boolean> {
    const parsed = this.parse(encoded);
    if (!parsed) {
      return false;
    }

    const derived = await this.derive(password, parsed.salt, parsed.policy);
    return derived.length === parsed.digest.length && timingSafeEqual(derived, parsed.digest);
  }

  public needsRehash(encoded: string): boolean {
    const parsed = this.parse(encoded);
    return (
      parsed === undefined ||
      Object.entries(this.policy).some(([key, value]) => parsed.policy[key as keyof typeof this.policy] !== value)
    );
  }

  private async derive(password: string, salt: Buffer, policy: Required<Argon2idPasswordPolicy>): Promise<Buffer> {
    return derivePassword("argon2id", {
      message: Buffer.from(password, "utf8"),
      nonce: salt,
      memory: policy.memory,
      passes: policy.passes,
      parallelism: policy.parallelism,
      tagLength: policy.tagLength,
      type: "argon2id",
    });
  }

  private parse(
    encoded: string,
  ): { salt: Buffer; digest: Buffer; policy: Required<Argon2idPasswordPolicy> } | undefined {
    const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(encoded);
    if (!match) {
      return undefined;
    }

    const [, memoryText, passesText, parallelismText, saltText, digestText] = match;
    if (!memoryText || !passesText || !parallelismText || !saltText || !digestText) {
      return undefined;
    }

    const salt = decode(saltText);
    const digest = decode(digestText);
    const policy = {
      memory: Number.parseInt(memoryText, 10),
      passes: Number.parseInt(passesText, 10),
      parallelism: Number.parseInt(parallelismText, 10),
      tagLength: this.policy.tagLength,
      saltLength: salt.length,
    };

    if (
      !Number.isSafeInteger(policy.memory) ||
      !Number.isSafeInteger(policy.passes) ||
      !Number.isSafeInteger(policy.parallelism) ||
      salt.length < 8 ||
      digest.length !== this.policy.tagLength
    ) {
      return undefined;
    }

    return { salt, digest, policy };
  }
}
