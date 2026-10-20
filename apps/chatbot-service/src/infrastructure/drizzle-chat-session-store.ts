import { and, asc, count, eq, gte } from "drizzle-orm";

import { chatProductRefsSchema } from "../contracts/chat.ts";
import {
  ChatHistoryCorruptError,
  ChatRateLimitedError,
  ChatSessionFullError,
  type ChatExchange,
  type ChatSessionStore,
  type StoredTurn,
} from "../modules/chat/chat-session-store.ts";
import type { ChatDatabase, ChatDrizzleDatabase } from "../shared/infrastructure/database.ts";
import { chatMessages, chatSessions } from "../shared/infrastructure/schema.ts";

type Queryable = Pick<ChatDrizzleDatabase, "select">;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const countCustomerQuestions = async (db: Queryable, input: { customerId: string; since: Date }): Promise<number> => {
  const [row] = await db
    .select({ value: count() })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.customerId, input.customerId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, input.since),
      ),
    );
  return row?.value ?? 0;
};

export class DrizzleChatSessionStore implements ChatSessionStore {
  private readonly database: ChatDatabase;

  public constructor(database: ChatDatabase) {
    this.database = database;
  }

  public async createSession(customerId: string): Promise<string> {
    const [row] = await this.database.db.insert(chatSessions).values({ customerId }).returning({ id: chatSessions.id });
    if (!row) throw new Error("chat session insert returned no row");
    return row.id;
  }

  public async findOwnedHistory(input: { sessionId: string; customerId: string }): Promise<StoredTurn[] | undefined> {
    const db = this.database.db;
    const [owned] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, input.sessionId), eq(chatSessions.customerId, input.customerId)))
      .limit(1);
    if (!owned) return undefined;
    const rows = await db
      .select({ role: chatMessages.role, content: chatMessages.content, products: chatMessages.products })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, input.sessionId))
      .orderBy(asc(chatMessages.seq));
    return rows.map((row) => {
      if (row.role === "user") return { role: "user", content: row.content };
      // Refs feed the prompt and the SKU allowlist, so a malformed row fails instead of replaying.
      const products = chatProductRefsSchema.safeParse(row.products);
      if (!products.success) throw new ChatHistoryCorruptError(input.sessionId);
      return { role: "assistant", content: row.content, products: products.data };
    });
  }

  public async countQuestionsSince(input: { customerId: string; since: Date }): Promise<number> {
    return countCustomerQuestions(this.database.db, input);
  }

  public async appendExchange(exchange: ChatExchange): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      // FOR UPDATE serializes saves per shopper, so each count below sees every earlier save.
      // PostgreSQL holds the locks until commit.
      await tx
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(eq(chatSessions.customerId, exchange.customerId))
        .for("update");

      const [inSession] = await tx
        .select({ value: count() })
        .from(chatMessages)
        .where(and(eq(chatMessages.sessionId, exchange.sessionId), eq(chatMessages.role, "user")));
      if ((inSession?.value ?? 0) >= exchange.limits.maxQuestionsPerSession) throw new ChatSessionFullError();

      const lastMinute = await countCustomerQuestions(tx, {
        customerId: exchange.customerId,
        since: new Date(exchange.now.getTime() - MINUTE_MS),
      });
      if (lastMinute >= exchange.limits.maxPerMinute) throw new ChatRateLimitedError();

      const lastDay = await countCustomerQuestions(tx, {
        customerId: exchange.customerId,
        since: new Date(exchange.now.getTime() - DAY_MS),
      });
      if (lastDay >= exchange.limits.maxPerDay) throw new ChatRateLimitedError();

      await tx.insert(chatMessages).values({
        sessionId: exchange.sessionId,
        role: "user",
        content: exchange.question,
      });
      await tx.insert(chatMessages).values({
        sessionId: exchange.sessionId,
        role: "assistant",
        content: exchange.reply,
        products: exchange.products,
      });
    });
  }
}
