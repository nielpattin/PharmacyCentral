import { createHash, randomBytes, randomUUID } from "node:crypto";

export type Session = {
  sessionId: string;
  accountId: string;
  expiresAt: Date;
  revokedAt?: Date;
};

export type CreatedSession = Session & { rawToken: string };

type StoredSession = Session & { tokenDigest: string };

export class InMemorySessionRepository {
  private readonly sessions = new Map<string, StoredSession>();

  public async create(accountId: string, expiresAt: Date): Promise<CreatedSession> {
    const rawToken = randomBytes(32).toString("base64url");
    const session: StoredSession = {
      sessionId: randomUUID(),
      accountId,
      expiresAt,
      tokenDigest: this.digest(rawToken),
    };
    this.sessions.set(session.sessionId, session);
    return { ...session, rawToken };
  }

  public async findActive(rawToken: string, now = new Date()): Promise<Session | undefined> {
    const tokenDigest = this.digest(rawToken);
    const session = [...this.sessions.values()].find((candidate) => candidate.tokenDigest === tokenDigest);
    if (!session || session.revokedAt || session.expiresAt <= now) {
      return undefined;
    }

    const { tokenDigest: _tokenDigest, ...publicSession } = session;
    return publicSession;
  }

  public async revoke(sessionId: string, now = new Date()): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.revokedAt = now;
    }
  }

  public async revokeAll(accountId: string, now = new Date()): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.accountId === accountId && !session.revokedAt) {
        session.revokedAt = now;
      }
    }
  }

  private digest(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }
}
