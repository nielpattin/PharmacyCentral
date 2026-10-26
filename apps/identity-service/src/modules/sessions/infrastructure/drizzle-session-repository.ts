import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import type { IdentityExecutor } from "../../../shared/infrastructure/database.ts";
import { sessions } from "../../../shared/infrastructure/schema.ts";
import type { CreatedSession, Session } from "./in-memory-session-repository.ts";

export class DrizzleSessionRepository {
  public constructor(private readonly executor: IdentityExecutor) {}

  public async create(accountId: string, expiresAt: Date): Promise<CreatedSession> {
    const rawToken = randomBytes(32).toString("base64url");
    const sessionId = randomUUID();
    const [session] = await this.executor
      .insert(sessions)
      .values({ id: sessionId, userId: accountId, tokenDigest: this.digest(rawToken), expiresAt })
      .returning();
    if (!session) throw new Error("Session insert did not return a row");
    return { sessionId: session.id, accountId: session.userId, expiresAt: session.expiresAt, rawToken };
  }

  public async findActive(rawToken: string, now = new Date()): Promise<Session | undefined> {
    const row = (
      await this.executor
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.tokenDigest, this.digest(rawToken)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
        )
        .limit(1)
    )[0];
    return row
      ? {
          sessionId: row.id,
          accountId: row.userId,
          expiresAt: row.expiresAt,
          ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
        }
      : undefined;
  }

  public async revoke(sessionId: string, now = new Date()): Promise<void> {
    await this.executor.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, sessionId));
  }

  public async revokeAll(accountId: string, now = new Date()): Promise<void> {
    await this.executor
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, accountId), isNull(sessions.revokedAt)));
  }

  private digest(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }
}
