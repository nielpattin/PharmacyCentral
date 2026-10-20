import type { ChatProductRef } from "../../contracts/chat.ts";

/** Only assistant replies carry product refs; a question never surfaces products. */
export type StoredTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; products: ChatProductRef[] };

export type ChatWriteLimits = {
  maxQuestionsPerSession: number;
  maxPerMinute: number;
  maxPerDay: number;
};

export type ChatExchange = {
  customerId: string;
  sessionId: string;
  question: string;
  reply: string;
  products: ChatProductRef[];
  limits: ChatWriteLimits;
  now: Date;
};

export class ChatSessionFullError extends Error {
  public constructor(message = "Chat session is full") {
    super(message);
    this.name = "ChatSessionFullError";
  }
}

export class ChatRateLimitedError extends Error {
  public constructor(message = "Too many questions") {
    super(message);
    this.name = "ChatRateLimitedError";
  }
}

export class ChatHistoryCorruptError extends Error {
  public constructor(sessionId: string) {
    super(`Chat session ${sessionId} holds malformed product references`);
    this.name = "ChatHistoryCorruptError";
  }
}

/**
 * Every read is scoped to one customer. A session id alone does not open another customer's history.
 */
export interface ChatSessionStore {
  createSession(customerId: string): Promise<string>;
  findOwnedHistory(input: { sessionId: string; customerId: string }): Promise<StoredTurn[] | undefined>;
  countQuestionsSince(input: { customerId: string; since: Date }): Promise<number>;
  /**
   * Saves the question and its reply, or saves nothing. Implementations check `limits` against the saved state inside
   * the same atomic write, and throw ChatSessionFullError or ChatRateLimitedError before inserting.
   */
  appendExchange(exchange: ChatExchange): Promise<void>;
}
