import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GATE_INTENTS, IntentGateError, type IntentGateInput } from "../domain/intent-gate.ts";
import type { AiProviderSettings } from "./ai-provider-config.ts";
import { BACKOFF_CAP_MS, JevIntentClassifier, MAX_ATTEMPTS, backoffDelayMs } from "./jev-intent-classifier.ts";

const SETTINGS: AiProviderSettings = {
  provider: "typesafe",
  model: "jev-latest",
  baseUrl: "https://jev.example.test",
  apiKey: "jev-key-1234",
};
const QUESTION: IntentGateInput = { question: "Chào shop", previousQuestion: undefined, previousReply: undefined };

const VERDICT_ANSWER = {
  model: "jev-latest",
  answers: {
    intent: { type: "choice", choice: "greeting", confidence: 0.92, probabilities: { greeting: 0.92 } },
    emergency: { type: "noul", noul: 0.01 },
    injection: { type: "noul", noul: 0.02 },
  },
  usage: { input_tokens: 300, output_tokens: 4 },
};

const requestSchema = z.object({
  model: z.string(),
  state: z.object({
    question: z.string(),
    previous_question: z.string().optional(),
    previous_reply: z.string().optional(),
  }),
  questions: z.object({
    intent: z.object({
      type: z.literal("choice"),
      instructions: z.string(),
      criteria: z.record(z.string(), z.string()),
    }),
    emergency: z.object({ type: z.literal("noul"), instructions: z.string() }),
    injection: z.object({ type: z.literal("noul"), instructions: z.string() }),
  }),
});

/** Parses the JSON body of the first request, failing the test when the body is not text. */
const sentRequest = (fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }) => {
  const init = fetchMock.mock.calls[0]?.[1];
  if (typeof init?.body !== "string") throw new Error("request body is not text");
  const parsed: unknown = JSON.parse(init.body);
  return requestSchema.parse(parsed);
};

describe("JevIntentClassifier request", () => {
  it("posts one request to the systemone endpoint with the bearer key and three questions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(VERDICT_ANSWER));
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, random: () => 0.5 });

    await classifier.classify({
      question: "Thuốc này giá bao nhiêu?",
      previousQuestion: "Có thuốc ho nào không?",
      previousReply: "Có Siro ho thảo dược.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toEqual(new URL("https://jev.example.test/v1/systemone"));
    expect(call?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer jev-key-1234" },
    });
    const sent = sentRequest(fetchMock);
    expect(sent.model).toBe("jev-latest");
    expect(sent.state).toEqual({
      question: "Thuốc này giá bao nhiêu?",
      previous_question: "Có thuốc ho nào không?",
      previous_reply: "Có Siro ho thảo dược.",
    });
    expect(Object.keys(sent.questions)).toEqual(["intent", "emergency", "injection"]);
  });

  it("lists the intent options in GATE_INTENTS order, so the blocked intents come last", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(VERDICT_ANSWER));
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, random: () => 0.5 });

    await classifier.classify(QUESTION);

    const sent = sentRequest(fetchMock);
    expect(Object.keys(sent.questions.intent.criteria)).toEqual([...GATE_INTENTS]);
    expect(Object.keys(sent.questions.intent.criteria).slice(-2)).toEqual(["greeting", "out_of_scope"]);
  });

  it("leaves the previous exchange out of the state when there is none", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(VERDICT_ANSWER));
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, random: () => 0.5 });

    await classifier.classify(QUESTION);

    expect(sentRequest(fetchMock).state).toStrictEqual({ question: "Chào shop" });
  });
});

describe("JevIntentClassifier answers", () => {
  it("returns the verdict from a valid answer", async () => {
    const classifier = new JevIntentClassifier(SETTINGS, {
      fetch: vi.fn<typeof fetch>(async () => Response.json(VERDICT_ANSWER)),
      random: () => 0.5,
    });

    await expect(classifier.classify(QUESTION)).resolves.toEqual({
      intent: "greeting",
      intentConfidence: 0.92,
      emergency: 0.01,
      injection: 0.02,
    });
  });

  it("keeps a null confidence as null rather than inventing one", async () => {
    const answer = {
      ...VERDICT_ANSWER,
      answers: { ...VERDICT_ANSWER.answers, intent: { ...VERDICT_ANSWER.answers.intent, confidence: null } },
    };
    const classifier = new JevIntentClassifier(SETTINGS, {
      fetch: vi.fn<typeof fetch>(async () => Response.json(answer)),
      random: () => 0.5,
    });

    await expect(classifier.classify(QUESTION)).resolves.toMatchObject({ intentConfidence: null });
  });

  it("throws at once, with no retry, when the choice is not a known intent", async () => {
    const answer = {
      ...VERDICT_ANSWER,
      answers: { ...VERDICT_ANSWER.answers, intent: { ...VERDICT_ANSWER.answers.intent, choice: "chit_chat" } },
    };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(answer));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, sleep, random: () => 0.5 });

    await expect(classifier.classify(QUESTION)).rejects.toBeInstanceOf(IntentGateError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["a body that breaks the schema", () => Response.json({ answers: {} })],
  ])("throws at once, with no retry, on %s", async (_name, respond) => {
    const fetchMock = vi.fn<typeof fetch>(async () => respond());
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, sleep, random: () => 0.5 });

    await expect(classifier.classify(QUESTION)).rejects.toBeInstanceOf(IntentGateError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("JevIntentClassifier retries", () => {
  it("succeeds after one backoff when a 429 is followed by a 200", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(Response.json(VERDICT_ANSWER));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, sleep, random: () => 0.5 });

    await expect(classifier.classify(QUESTION)).resolves.toMatchObject({ intent: "greeting" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[100]]);
  });

  it.each([
    ["HTTP 408", async () => new Response("timeout", { status: 408 })],
    ["HTTP 500", async () => new Response("boom", { status: 500 })],
    ["HTTP 529 overloaded", async () => new Response("overloaded", { status: 529 })],
    [
      "a network rejection",
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("retries %s up to MAX_ATTEMPTS, then throws IntentGateError", async (_name, respond) => {
    const fetchMock = vi.fn<typeof fetch>(respond);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, sleep, random: () => 0.5 });

    await expect(classifier.classify(QUESTION)).rejects.toBeInstanceOf(IntentGateError);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
  });

  it("names the last failure in the message and keeps it as the cause", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("overloaded", { status: 529 }));
    const classifier = new JevIntentClassifier(SETTINGS, {
      fetch: fetchMock,
      sleep: async () => undefined,
      random: () => 0.5,
    });

    const failure = await classifier.classify(QUESTION).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IntentGateError);
    expect(failure).toHaveProperty("message", "Jev gave no answer after 3 attempts (Jev answered HTTP 529)");
    expect(failure).toHaveProperty("cause.name", "IntentGateError");
  });

  it.each([401, 422])("throws at once, with exactly one call and no backoff, on HTTP %i", async (status) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("rejected", { status }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, sleep, random: () => 0.5 });

    await expect(classifier.classify(QUESTION)).rejects.toBeInstanceOf(IntentGateError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("JevIntentClassifier backoff", () => {
  it("waits a full-jitter share of each capped step between attempts", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("overloaded", { status: 529 }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const classifier = new JevIntentClassifier(SETTINGS, { fetch: fetchMock, sleep, random: () => 0.5 });

    await classifier.classify(QUESTION).catch(() => undefined);

    // Half of the step after attempt 1 (200 ms) and after attempt 2 (400 ms).
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("draws each wait from zero up to its step", () => {
    expect(backoffDelayMs(1, () => 0)).toBe(0);
    expect(backoffDelayMs(2, () => 0.999)).toBeLessThan(400);
  });

  it("never waits longer than BACKOFF_CAP_MS", () => {
    expect(backoffDelayMs(20, () => 0.5)).toBe(BACKOFF_CAP_MS / 2);
  });
});

describe("JevIntentClassifier errors", () => {
  const question = "Bệnh nhân Nguyễn Văn A bị tiêu chảy";

  it.each([
    [
      "an echoed question on HTTP 422",
      vi.fn<typeof fetch>(async () => new Response(`echo: ${question}`, { status: 422 })),
    ],
    [
      "an echoed question after the retries run out",
      vi.fn<typeof fetch>(async () => new Response(`echo: ${question}`, { status: 500 })),
    ],
    [
      "an echoed question in a body that is not the answer",
      vi.fn<typeof fetch>(async () => new Response(`echo: ${question}`, { status: 200 })),
    ],
  ])("keeps the question and the api key out of the message for %s", async (_name, fetchMock) => {
    const classifier = new JevIntentClassifier(SETTINGS, {
      fetch: fetchMock,
      sleep: async () => undefined,
      random: () => 0.5,
    });

    const failure = await classifier
      .classify({ question, previousQuestion: undefined, previousReply: undefined })
      .catch((error: unknown) => error);

    if (!(failure instanceof IntentGateError)) throw new Error("expected an IntentGateError");
    expect(failure.message).not.toContain(question);
    expect(failure.message).not.toContain("jev-key-1234");
  });
});
