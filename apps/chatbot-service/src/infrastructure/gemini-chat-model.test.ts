import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatCompletionInput, ChatToolCall, ChatToolResult, ToolProduct } from "../domain/chat-model.ts";
import { ChatModelError } from "../domain/chat-model.ts";
import { GeminiChatModel } from "./gemini-chat-model.ts";

const SETTINGS = { baseUrl: "https://gemini.example.test", model: "gemini-test", apiKey: "test-key-1234" };
const NO_TOOLS = {
  tools: [],
  runTool: async (): Promise<ChatToolResult> => ({ error: "unknown_tool" }),
  maxToolRounds: 2,
};
const PANADOL: ToolProduct = {
  sku: "PAN-500",
  name: "Panadol",
  manufacturer: null,
  prescriptionRequired: false,
  indications: null,
  price: null,
};
const INPUT: ChatCompletionInput = {
  systemInstruction: "rules",
  turns: [{ role: "user", content: "Chào" }],
  ...NO_TOOLS,
};
const SEARCH_TOOL = {
  name: "search_products",
  description: "Tìm sản phẩm",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};

const answer = (text: string): Response =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const answerWithUsage = (text: string, usageMetadata: Record<string, number>): Response =>
  Response.json({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata });

const modelReply = (parts: unknown[], usageMetadata?: Record<string, number>): Response =>
  Response.json({ candidates: [{ content: { role: "model", parts } }], ...(usageMetadata ? { usageMetadata } : {}) });

const requestBodies = (fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }): unknown[] =>
  fetchMock.mock.calls.map(([, init]) => {
    if (typeof init?.body !== "string") throw new Error("request body is not text");
    const parsed: unknown = JSON.parse(init.body);
    return parsed;
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeminiChatModel", () => {
  it("sends the conversation as Gemini turns to the model named in its settings and returns the text", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => answer("Xin chào, tôi giúp gì được?"));
    vi.stubGlobal("fetch", fetchMock);
    const model = new GeminiChatModel(SETTINGS);

    const completion = await model.complete({
      ...NO_TOOLS,
      systemInstruction: "rules",
      turns: [
        { role: "user", content: "Chào" },
        { role: "assistant", content: "Xin chào" },
        { role: "user", content: "Cảm ơn" },
      ],
    });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toEqual(new URL("https://gemini.example.test/v1beta/models/gemini-test:generateContent"));
    expect(init?.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "test-key-1234" });
    expect(requestBodies(fetchMock)[0]).toMatchObject({
      systemInstruction: { parts: [{ text: "rules" }] },
      contents: [
        { role: "user", parts: [{ text: "Chào" }] },
        { role: "model", parts: [{ text: "Xin chào" }] },
        { role: "user", parts: [{ text: "Cảm ơn" }] },
      ],
      generationConfig: { temperature: 0.3 },
    });
    expect(completion).toEqual({ text: "Xin chào, tôi giúp gì được?", usage: undefined, modelCalls: 1 });
  });

  it("maps usageMetadata to the counts Gemini billed, including cached and thought tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        answerWithUsage("Chào bạn", {
          promptTokenCount: 1200,
          cachedContentTokenCount: 1024,
          candidatesTokenCount: 80,
          thoughtsTokenCount: 300,
          totalTokenCount: 1580,
        }),
      ),
    );

    const completion = await new GeminiChatModel(SETTINGS).complete(INPUT);

    expect(completion).toEqual({
      text: "Chào bạn",
      usage: { inputTokens: 1200, cachedInputTokens: 1024, outputTokens: 80, thoughtTokens: 300 },
      modelCalls: 1,
    });
  });

  it("counts a usage field Gemini left out as zero when the usage block is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => answerWithUsage("Chào bạn", { promptTokenCount: 900, candidatesTokenCount: 12 })),
    );

    const completion = await new GeminiChatModel(SETTINGS).complete(INPUT);

    expect(completion.usage).toEqual({ inputTokens: 900, cachedInputTokens: 0, outputTokens: 12, thoughtTokens: 0 });
  });

  it("refuses a usage count that is negative or not a whole number", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => answerWithUsage("Chào bạn", { promptTokenCount: -1 })),
    );

    await expect(new GeminiChatModel(SETTINGS).complete(INPUT)).rejects.toThrow(
      "Gemini returned an unexpected response shape",
    );
  });

  it("reports a provider failure without echoing the shopper's question", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("Bệnh nhân Nguyễn Văn A bị tiêu chảy", { status: 400 })),
    );

    const failure = await new GeminiChatModel(SETTINGS)
      .complete({ ...NO_TOOLS, systemInstruction: "rules", turns: [{ role: "user", content: "tôi bị tiêu chảy" }] })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(failure).toHaveProperty("message", "Gemini answered HTTP 400");
  });

  it("reports a network failure as a ChatModelError with the cause attached", async () => {
    const cause = new TypeError("fetch failed");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw cause;
      }),
    );

    const failure = await new GeminiChatModel(SETTINGS).complete(INPUT).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(failure).toHaveProperty("cause", cause);
  });

  it("reports a response that is not JSON or has no text as a ChatModelError", async () => {
    const model = new GeminiChatModel(SETTINGS);

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 })),
    );
    await expect(model.complete(INPUT)).rejects.toThrow("Gemini returned a non-JSON response");

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json(null)),
    );
    await expect(model.complete(INPUT)).rejects.toThrow("Gemini returned an unexpected response shape");

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({ candidates: [{ finishReason: "SAFETY" }] })),
    );
    await expect(model.complete(INPUT)).rejects.toThrow("Gemini returned no text (finish reason SAFETY)");
  });

  it("reports a blocked prompt with the provider's block reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({ promptFeedback: { blockReason: "SAFETY" } })),
    );

    await expect(new GeminiChatModel(SETTINGS).complete(INPUT)).rejects.toThrow("Gemini blocked the question: SAFETY");
  });

  it("uses the settings it was built with for every call", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => answer("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const model = new GeminiChatModel(SETTINGS);

    await model.complete(INPUT);
    await model.complete(INPUT);

    const sentKeys = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("x-goog-api-key"));
    expect(sentKeys).toEqual(["test-key-1234", "test-key-1234"]);
  });

  it("declares the tools with AUTO mode and answers without a tool call in one request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => answer("Xin chào"));
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async () => ({ error: "unknown_tool" }));

    const completion = await new GeminiChatModel(SETTINGS).complete({
      ...INPUT,
      tools: [SEARCH_TOOL],
      runTool,
    });

    expect(requestBodies(fetchMock)).toHaveLength(1);
    expect(requestBodies(fetchMock)[0]).toMatchObject({
      tools: [
        {
          functionDeclarations: [
            {
              name: "search_products",
              description: "Tìm sản phẩm",
              parametersJsonSchema: SEARCH_TOOL.parameters,
            },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    });
    expect(runTool).not.toHaveBeenCalled();
    expect(completion).toEqual({ text: "Xin chào", usage: undefined, modelCalls: 1 });
  });

  it("sends the first candidate's parts back verbatim, then the function results as one user turn", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        modelReply(
          [
            {
              functionCall: { id: "call-1", name: "search_products", args: { query: "đau đầu" } },
              thoughtSignature: "sig-1",
            },
          ],
          { promptTokenCount: 100, candidatesTokenCount: 10 },
        ),
      )
      .mockResolvedValueOnce(
        modelReply([{ text: "Có Panadol." }], { promptTokenCount: 150, candidatesTokenCount: 20 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async () => ({ products: [PANADOL] }));

    const completion = await new GeminiChatModel(SETTINGS).complete({ ...INPUT, tools: [SEARCH_TOOL], runTool });

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith({ name: "search_products", args: { query: "đau đầu" } });
    const [, secondRequest] = requestBodies(fetchMock);
    expect(secondRequest).toMatchObject({
      contents: [
        { role: "user", parts: [{ text: "Chào" }] },
        {
          role: "model",
          parts: [
            {
              functionCall: { id: "call-1", name: "search_products", args: { query: "đau đầu" } },
              thoughtSignature: "sig-1",
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "call-1",
                name: "search_products",
                response: { products: [PANADOL] },
              },
            },
          ],
        },
      ],
    });
    expect(completion).toEqual({
      text: "Có Panadol.",
      usage: { inputTokens: 250, cachedInputTokens: 0, outputTokens: 30, thoughtTokens: 0 },
      modelCalls: 2,
    });
  });

  it("runs parallel calls in order and answers them in one user turn", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        modelReply([
          { functionCall: { name: "search_products", args: { query: "ho" } } },
          { functionCall: { id: "call-2", name: "get_product_details", args: { sku: "SIR-1" } } },
        ]),
      )
      .mockResolvedValueOnce(modelReply([{ text: "Xong." }]));
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async (call) => ({
      error: call.name === "search_products" ? "invalid_arguments" : "unknown_sku",
    }));

    await new GeminiChatModel(SETTINGS).complete({ ...INPUT, tools: [SEARCH_TOOL], runTool });

    expect(runTool.mock.calls.map(([call]) => call)).toEqual([
      { name: "search_products", args: { query: "ho" } },
      { name: "get_product_details", args: { sku: "SIR-1" } },
    ]);
    const [, secondRequest] = requestBodies(fetchMock);
    expect(secondRequest).toMatchObject({
      contents: [
        expect.anything(),
        expect.anything(),
        {
          role: "user",
          parts: [
            { functionResponse: { name: "search_products", response: { error: "invalid_arguments" } } },
            {
              functionResponse: {
                id: "call-2",
                name: "get_product_details",
                response: { error: "unknown_sku" },
              },
            },
          ],
        },
      ],
    });
  });

  it("disables tools on the last allowed call while still declaring them, and rejects a call made then", async () => {
    const functionCallReply = (): Response =>
      modelReply([{ functionCall: { name: "search_products", args: { query: "ho" } } }]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(functionCallReply())
      .mockResolvedValueOnce(functionCallReply())
      .mockResolvedValueOnce(functionCallReply());
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async () => ({ error: "unknown_tool" }));

    const failure = await new GeminiChatModel(SETTINGS)
      .complete({ ...INPUT, tools: [SEARCH_TOOL], runTool, maxToolRounds: 2 })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(runTool).toHaveBeenCalledTimes(2);
    const bodies = requestBodies(fetchMock);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toMatchObject({
      tools: [{ functionDeclarations: [{ name: "search_products" }] }],
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
    });
    expect(bodies[1]).toMatchObject({ toolConfig: { functionCallingConfig: { mode: "AUTO" } } });
  });

  it("propagates an error thrown by runTool unchanged and sends no further request", async () => {
    class ToolBoom extends Error {}
    const boom = new ToolBoom("catalog down");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(modelReply([{ functionCall: { name: "search_products", args: { query: "ho" } } }]));
    vi.stubGlobal("fetch", fetchMock);

    const failure = await new GeminiChatModel(SETTINGS)
      .complete({
        ...INPUT,
        tools: [SEARCH_TOOL],
        runTool: async () => {
          throw boom;
        },
      })
      .catch((error: unknown) => error);

    expect(failure).toBe(boom);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports usage as undefined when any call came back without a usage block", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        modelReply([{ functionCall: { name: "search_products", args: { query: "ho" } } }], {
          promptTokenCount: 100,
          candidatesTokenCount: 10,
        }),
      )
      .mockResolvedValueOnce(modelReply([{ text: "Xong." }]));
    vi.stubGlobal("fetch", fetchMock);

    const completion = await new GeminiChatModel(SETTINGS).complete({
      ...INPUT,
      tools: [SEARCH_TOOL],
      runTool: async () => ({ error: "unknown_tool" }),
    });

    expect(completion).toEqual({ text: "Xong.", usage: undefined, modelCalls: 2 });
  });

  it("sends neither tools nor toolConfig when no tools are offered", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => answer("Xin chào"));
    vi.stubGlobal("fetch", fetchMock);

    await new GeminiChatModel(SETTINGS).complete(INPUT);

    const [body] = requestBodies(fetchMock);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("toolConfig");
  });

  it("leaves thought parts out of the answer text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        modelReply([{ text: "Suy nghĩ nội bộ", thought: true }, { text: "Đây là câu trả lời." }]),
      ),
    );

    const completion = await new GeminiChatModel(SETTINGS).complete(INPUT);

    expect(completion.text).toBe("Đây là câu trả lời.");
  });
});
