import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pino from "pino";

import { createApp } from "../../app.ts";
import { chatModelProviders } from "../../contracts/credentials.ts";
import { bearerHeaders, testVerifier } from "../../test-support/access-tokens.ts";
import type { ChatCompletionInput, ChatModel, ProductLookup } from "../../domain/chat-model.ts";
import type { IntentGate } from "../../domain/intent-gate.ts";
import { IntentGateError } from "../../domain/intent-gate.ts";
import { AiBudgetExceededError, AiCapacityError, AiPricingMissingError } from "../ai-budget/ai-budget-errors.ts";
import type { ChatExchange, ChatSessionStore, StoredTurn } from "./chat-session-store.ts";
import { randomBytes } from "node:crypto";
import { SecretBox } from "../../infrastructure/secret-box.ts";
import { AiCredentialVault } from "../credentials/ai-credential-vault.ts";
import { createMemoryCredentialStore } from "../credentials/memory-credential-store.ts";
import { CHATBOT_CREDENTIAL_PATH } from "../credentials/credential-routes.ts";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const OTHER_CUSTOMER = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE = "33333333-3333-4333-8333-333333333333";

const signedHeader = async (actorType: "customer" | "employee", actorId: string): Promise<string> =>
  (await bearerHeaders({ actorType, actorId })).authorization as string;

const memoryStore = (): ChatSessionStore => {
  const sessions = new Map<string, { customerId: string; turns: StoredTurn[] }>();
  let created = 0;
  return {
    createSession: async (customerId) => {
      created += 1;
      const id = `00000000-0000-4000-8000-00000000000${created}`;
      sessions.set(id, { customerId, turns: [] });
      return id;
    },
    findOwnedHistory: async ({ sessionId, customerId }) => {
      const session = sessions.get(sessionId);
      return session && session.customerId === customerId ? session.turns : undefined;
    },
    countQuestionsSince: async () => 0,
    appendExchange: async (exchange: ChatExchange) => {
      const session = sessions.get(exchange.sessionId);
      session?.turns.push(
        { role: "user", content: exchange.question },
        { role: "assistant", content: exchange.reply, products: exchange.products },
      );
    },
  };
};

describe("chatbot routes", () => {
  const model: ChatModel = {
    complete: async (_input: ChatCompletionInput) => ({
      text: "Smecta giúp điều trị tiêu chảy.",
      usage: undefined,
      modelCalls: 1,
    }),
  };
  const products: ProductLookup = { search: async () => [], details: async () => undefined };
  let gateFailure: Error | undefined;
  const gate: IntentGate = {
    check: async () => {
      if (gateFailure) throw gateFailure;
      return { intent: "product_detail", intentConfidence: 0.9, emergency: 0, injection: 0 };
    },
  };
  const vault = new AiCredentialVault({
    store: createMemoryCredentialStore(),
    sealer: new SecretBox(randomBytes(32).toString("base64")),
    purpose: "chatbot",
    fallback: undefined,
    cacheMs: 60_000,
  });
  const app = createApp({
    verifier: testVerifier,
    deps: { model, products, store: memoryStore(), gate, reportUsage: vi.fn(), reportGate: vi.fn() },
    credentials: [
      {
        path: CHATBOT_CREDENTIAL_PATH,
        providers: chatModelProviders,
        vault,
      },
    ],
    logger: pino({ level: "silent" }),
  });
  let baseUrl = "";
  let server: Server;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("refuses a request without an access token", async () => {
    const response = await fetch(`${baseUrl}/chatbot/sessions`, { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("refuses an employee even with a valid access token", async () => {
    const response = await fetch(`${baseUrl}/chatbot/sessions`, {
      method: "POST",
      headers: { authorization: await signedHeader("employee", EMPLOYEE) },
    });
    expect(response.status).toBe(401);
  });

  it("lets a signed-in customer open a session and ask in it, and hides that session from another customer", async () => {
    const created = await fetch(`${baseUrl}/chatbot/sessions`, {
      method: "POST",
      headers: { authorization: await signedHeader("customer", CUSTOMER) },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const asked = await fetch(`${baseUrl}/chatbot/sessions/${id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await signedHeader("customer", CUSTOMER),
      },
      body: JSON.stringify({ content: "tiêu chảy" }),
    });
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ reply: "Smecta giúp điều trị tiêu chảy.", products: [] });

    const intruder = await fetch(`${baseUrl}/chatbot/sessions/${id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await signedHeader("customer", OTHER_CUSTOMER),
      },
      body: JSON.stringify({ content: "tiêu chảy" }),
    });
    expect(intruder.status).toBe(404);
  });

  it("answers 503 assistant_unavailable when the intent gate fails", async () => {
    const created = await fetch(`${baseUrl}/chatbot/sessions`, {
      method: "POST",
      headers: { authorization: await signedHeader("customer", CUSTOMER) },
    });
    const { id } = (await created.json()) as { id: string };
    gateFailure = new IntentGateError("Jev gave no answer after 3 attempts (Jev answered HTTP 529)");
    try {
      const asked = await fetch(`${baseUrl}/chatbot/sessions/${id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await signedHeader("customer", CUSTOMER),
        },
        body: JSON.stringify({ content: "tiêu chảy" }),
      });
      expect(asked.status).toBe(503);
      expect(await asked.json()).toEqual({
        title: "Assistant unavailable",
        status: 503,
        code: "assistant_unavailable",
      });
    } finally {
      gateFailure = undefined;
    }
  });

  describe("AI budget failures", () => {
    const askAfterSession = async (failure: Error) => {
      const created = await fetch(`${baseUrl}/chatbot/sessions`, {
        method: "POST",
        headers: { authorization: await signedHeader("customer", CUSTOMER) },
      });
      const { id } = (await created.json()) as { id: string };
      gateFailure = failure;
      try {
        return await fetch(`${baseUrl}/chatbot/sessions/${id}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: await signedHeader("customer", CUSTOMER),
          },
          body: JSON.stringify({ content: "tiêu chảy" }),
        });
      } finally {
        gateFailure = undefined;
      }
    };

    it("answers 429 ai_budget_exceeded before any model call when the spend limit is reached", async () => {
      const response = await askAfterSession(new AiBudgetExceededError("day"));

      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ status: 429, code: "ai_budget_exceeded" });
    });

    it("answers 503 assistant_busy with Retry-After when no call slot frees up in time", async () => {
      const response = await askAfterSession(new AiCapacityError());

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(await response.json()).toMatchObject({ status: 503, code: "assistant_busy" });
    });

    it("answers 503 assistant_unavailable when a spend limit cannot be priced", async () => {
      const response = await askAfterSession(new AiPricingMissingError("typesafe", "jev-latest"));

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ status: 503, code: "assistant_unavailable" });
    });
  });

  it("answers 409 session_full once a session holds 20 saved questions", async () => {
    const created = await fetch(`${baseUrl}/chatbot/sessions`, {
      method: "POST",
      headers: { authorization: await signedHeader("customer", CUSTOMER) },
    });
    const { id } = (await created.json()) as { id: string };
    const ask = async () =>
      fetch(`${baseUrl}/chatbot/sessions/${id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await signedHeader("customer", CUSTOMER),
        },
        body: JSON.stringify({ content: "chào" }),
      });
    for (let index = 0; index < 20; index += 1) {
      expect((await ask()).status).toBe(200);
    }

    const full = await ask();
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ title: "Chat session is full", status: 409, code: "session_full" });
  });
});
