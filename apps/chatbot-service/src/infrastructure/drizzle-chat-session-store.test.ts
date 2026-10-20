import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ChatHistoryCorruptError,
  ChatRateLimitedError,
  ChatSessionFullError,
  type ChatWriteLimits,
} from "../modules/chat/chat-session-store.ts";
import type { ChatDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { DrizzleChatSessionStore } from "./drizzle-chat-session-store.ts";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const OTHER_CUSTOMER = "22222222-2222-4222-8222-222222222222";
const SMECTA = { id: "6b1f0c2e-6f0e-4c1e-9a33-1f0a2b3c4d5e", sku: "THU-0025", name: "Smecta" };
const LIMITS: ChatWriteLimits = { maxQuestionsPerSession: 20, maxPerMinute: 10, maxPerDay: 100 };

describe("DrizzleChatSessionStore", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const store = new DrizzleChatSessionStore({ db, pool: undefined } as unknown as ChatDatabase);

  const exchange = (sessionId: string, customerId = CUSTOMER, question = "tiêu chảy") => ({
    customerId,
    sessionId,
    question,
    reply: "Smecta giúp điều trị tiêu chảy.",
    products: [SMECTA],
    limits: LIMITS,
    now: new Date(),
  });

  const insertQuestions = async (sessionId: string, total: number) => {
    for (let index = 0; index < total; index += 1) {
      await client.query("INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)", [
        sessionId,
        `câu ${index}`,
      ]);
    }
  };

  const messageCount = async (sessionId: string): Promise<number> => {
    const rows = await client.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM chat_messages WHERE session_id = $1",
      [sessionId],
    );
    return rows.rows[0]?.total ?? -1;
  };

  beforeAll(async () => {
    const migration = new URL("../../drizzle/migrations/0000_chat_sessions.sql", import.meta.url);
    await client.exec(await readFile(migration, "utf8"));
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM chat_messages; DELETE FROM chat_sessions;");
  });

  afterAll(async () => {
    await client.close();
  });

  it("returns undefined for another customer's session", async () => {
    const sessionId = await store.createSession(CUSTOMER);

    expect(await store.findOwnedHistory({ sessionId, customerId: OTHER_CUSTOMER })).toBeUndefined();
  });

  it("returns history oldest first, with products only on assistant turns", async () => {
    const sessionId = await store.createSession(CUSTOMER);
    await store.appendExchange(exchange(sessionId, CUSTOMER, "câu một"));
    await store.appendExchange(exchange(sessionId, CUSTOMER, "câu hai"));

    expect(await store.findOwnedHistory({ sessionId, customerId: CUSTOMER })).toEqual([
      { role: "user", content: "câu một" },
      { role: "assistant", content: "Smecta giúp điều trị tiêu chảy.", products: [SMECTA] },
      { role: "user", content: "câu hai" },
      { role: "assistant", content: "Smecta giúp điều trị tiêu chảy.", products: [SMECTA] },
    ]);
  });

  it("throws ChatHistoryCorruptError when an assistant row's products are malformed", async () => {
    const sessionId = await store.createSession(CUSTOMER);
    await client.query(
      "INSERT INTO chat_messages (session_id, role, content, products) VALUES ($1, 'assistant', 'Trả lời.', $2::jsonb)",
      [sessionId, JSON.stringify([{ id: "not-a-uuid", sku: "", name: 5 }])],
    );

    const history = store.findOwnedHistory({ sessionId, customerId: CUSTOMER });

    await expect(history).rejects.toBeInstanceOf(ChatHistoryCorruptError);
    await expect(history).rejects.toThrow(sessionId);
  });

  it("refuses the 21st question with ChatSessionFullError and saves nothing", async () => {
    const sessionId = await store.createSession(CUSTOMER);
    await insertQuestions(sessionId, LIMITS.maxQuestionsPerSession);
    const before = await messageCount(sessionId);

    await expect(store.appendExchange(exchange(sessionId))).rejects.toBeInstanceOf(ChatSessionFullError);
    expect(await messageCount(sessionId)).toBe(before);
  });

  it("refuses when the customer already has 10 questions in the last minute, and saves nothing", async () => {
    const earlier = await store.createSession(CUSTOMER);
    await insertQuestions(earlier, LIMITS.maxPerMinute);
    const sessionId = await store.createSession(CUSTOMER);

    await expect(store.appendExchange(exchange(sessionId))).rejects.toBeInstanceOf(ChatRateLimitedError);
    expect(await messageCount(sessionId)).toBe(0);
  });
});
