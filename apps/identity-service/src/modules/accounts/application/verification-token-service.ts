import { createHash, randomBytes } from "node:crypto";

export type VerificationToken = {
  token: string;
  accountId: string;
  expiresAt: Date;
};

type StoredToken = VerificationToken & {
  digest: string;
  consumed: boolean;
};

export class VerificationTokenService {
  private readonly tokens = new Map<string, StoredToken>();

  public async issue(accountId: string, expiresAt: Date): Promise<VerificationToken> {
    const token = randomBytes(32).toString("base64url");
    const stored: StoredToken = {
      token,
      accountId,
      expiresAt,
      digest: this.digest(token),
      consumed: false,
    };
    this.tokens.set(stored.digest, stored);
    return { token, accountId, expiresAt };
  }

  public async consume(token: string, accountId: string, now = new Date()): Promise<boolean> {
    const stored = this.tokens.get(this.digest(token));
    if (!stored || stored.consumed || stored.accountId !== accountId || stored.expiresAt <= now) {
      return false;
    }

    stored.consumed = true;
    return true;
  }

  private digest(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
