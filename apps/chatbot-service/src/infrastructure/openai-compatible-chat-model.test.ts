import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatCompletionInput, ChatToolCall, ChatToolResult, ToolProduct } from "../domain/chat-model.ts";
import { ChatModelError } from "../domain/chat-model.ts";
import { OpenAiCompatibleChatModel } from "./openai-compatible-chat-model.ts";

const SETTINGS = { baseUrl: "https://model.example.test/endpoints/v1", model: "glm-test", apiKey: "test-key-1234" };
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
const OPENAI_TOOL = {
  type: "function",
  function: { name: "search_products", description: "Tìm sản phẩm", parameters: SEARCH_TOOL.parameters },
};
const SEARCH_CALL = {
  id: "call-1",
  type: "function",
  function: { name: "search_products", arguments: '{"query":"đau đầu"}' },
};

const requestBodies = (fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }): unknown[] =>
  fetchMock.mock.calls.map(([, init]) => {
    if (typeof init?.body !== "string") throw new Error("request body is not text");
    const parsed: unknown = JSON.parse(init.body);
    return parsed;
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAiCompatibleChatModel", () => {
  it("posts to the base path plus /chat/completions with the bearer key and returns the trimmed answer", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { role: "assistant", content: "  Xin chào, tôi giúp gì được?\n" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const completion = await new OpenAiCompatibleChatModel(SETTINGS).complete(INPUT);

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://model.example.test/endpoints/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key-1234");
    expect(completion).toEqual({ text: "Xin chào, tôi giúp gì được?", usage: undefined, modelCalls: 1 });
  });

  it("does not drop a trailing slash or double it on the base URL", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAiCompatibleChatModel({ ...SETTINGS, baseUrl: "https://model.example.test/endpoints/v1//" }).complete(
      INPUT,
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://model.example.test/endpoints/v1/chat/completions");
  });

  it("sends the system instruction first, then the turns in order, with the model and temperature", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAiCompatibleChatModel(SETTINGS).complete({
      ...NO_TOOLS,
      systemInstruction: "rules",
      turns: [
        { role: "user", content: "Chào" },
        { role: "assistant", content: "Xin chào" },
        { role: "user", content: "Cảm ơn" },
      ],
    });

    expect(requestBodies(fetchMock)[0]).toMatchObject({
      model: "glm-test",
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "Chào" },
        { role: "assistant", content: "Xin chào" },
        { role: "user", content: "Cảm ơn" },
      ],
      temperature: 0.3,
    });
  });

  it("omits tools and tool_choice when no tools are offered", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { role: "assistant", content: "Xin chào" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAiCompatibleChatModel(SETTINGS).complete(INPUT);

    const [body] = requestBodies(fetchMock);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("declares the same tools on every call and switches tool_choice to none on the last round", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [SEARCH_CALL] } }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { role: "assistant", content: "Có Panadol." } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async () => ({ products: [PANADOL] }));

    await new OpenAiCompatibleChatModel(SETTINGS).complete({
      ...INPUT,
      tools: [SEARCH_TOOL],
      runTool,
      maxToolRounds: 1,
    });

    const [first, last] = requestBodies(fetchMock);
    expect(first).toMatchObject({ tools: [OPENAI_TOOL], tool_choice: "auto" });
    expect(last).toMatchObject({ tools: [OPENAI_TOOL], tool_choice: "none" });
  });

  it("runs the requested tool with its parsed arguments, posts the assistant message back verbatim, then returns the final text", async () => {
    const assistantMessage = {
      role: "assistant",
      content: null,
      tool_calls: [SEARCH_CALL],
      provider_note: "kept",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: assistantMessage }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { role: "assistant", content: "Có Panadol." } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async () => ({ products: [PANADOL] }));

    const completion = await new OpenAiCompatibleChatModel(SETTINGS).complete({
      ...INPUT,
      tools: [SEARCH_TOOL],
      runTool,
    });

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith({ name: "search_products", args: { query: "đau đầu" } });
    expect(requestBodies(fetchMock)[1]).toMatchObject({
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "Chào" },
        assistantMessage,
        { role: "tool", tool_call_id: "call-1", content: JSON.stringify({ products: [PANADOL] }) },
      ],
    });
    expect(completion).toEqual({ text: "Có Panadol.", usage: undefined, modelCalls: 2 });
  });

  it("runs parallel tool calls in order and answers each with its own tool_call_id", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  SEARCH_CALL,
                  {
                    id: "call-2",
                    type: "function",
                    function: { name: "get_product_details", arguments: '{"sku":"SIR-1"}' },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { role: "assistant", content: "Xong." } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async (call) => ({
      error: call.name === "search_products" ? "invalid_arguments" : "unknown_sku",
    }));

    await new OpenAiCompatibleChatModel(SETTINGS).complete({ ...INPUT, tools: [SEARCH_TOOL], runTool });

    expect(runTool.mock.calls.map(([call]) => call)).toEqual([
      { name: "search_products", args: { query: "đau đầu" } },
      { name: "get_product_details", args: { sku: "SIR-1" } },
    ]);
    expect(requestBodies(fetchMock)[1]).toMatchObject({
      messages: [
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { role: "tool", tool_call_id: "call-1", content: JSON.stringify({ error: "invalid_arguments" }) },
        { role: "tool", tool_call_id: "call-2", content: JSON.stringify({ error: "unknown_sku" }) },
      ],
    });
  });

  it("passes arguments that are not valid JSON to the tool as undefined", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "call-1", function: { name: "search_products", arguments: '{"query":' } }],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { role: "assistant", content: "Bạn cho tôi biết thêm nhé." } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async () => ({
      error: "invalid_arguments",
    }));

    const completion = await new OpenAiCompatibleChatModel(SETTINGS).complete({
      ...INPUT,
      tools: [SEARCH_TOOL],
      runTool,
    });

    expect(runTool).toHaveBeenCalledWith({ name: "search_products", args: undefined });
    expect(completion.text).toBe("Bạn cho tôi biết thêm nhé.");
  });

  it("ignores tool calls made on the last round and answers with the text", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { role: "assistant", content: null, tool_calls: [SEARCH_CALL] } }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            { message: { role: "assistant", content: "Bạn muốn hỏi thêm điều gì?", tool_calls: [SEARCH_CALL] } },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn<(call: ChatToolCall) => Promise<ChatToolResult>>(async () => ({ products: [PANADOL] }));

    const completion = await new OpenAiCompatibleChatModel(SETTINGS).complete({
      ...INPUT,
      tools: [SEARCH_TOOL],
      runTool,
      maxToolRounds: 1,
    });

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(requestBodies(fetchMock)[1]).toMatchObject({ tool_choice: "none" });
    expect(completion).toEqual({ text: "Bạn muốn hỏi thêm điều gì?", usage: undefined, modelCalls: 2 });
  });

  it("maps usage to the counts OpenAI billed, splitting reasoning out of completion tokens and reporting cached input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          choices: [{ message: { role: "assistant", content: "Chào bạn" } }],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 100,
            prompt_tokens_details: { cached_tokens: 1024 },
            completion_tokens_details: { reasoning_tokens: 30 },
          },
        }),
      ),
    );

    const completion = await new OpenAiCompatibleChatModel(SETTINGS).complete(INPUT);

    expect(completion).toEqual({
      text: "Chào bạn",
      usage: { inputTokens: 1200, cachedInputTokens: 1024, outputTokens: 70, thoughtTokens: 30 },
      modelCalls: 1,
    });
  });

  it("never reports negative output tokens when reasoning exceeds completion tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          choices: [{ message: { role: "assistant", content: "Chào bạn" } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 25 } },
        }),
      ),
    );

    const completion = await new OpenAiCompatibleChatModel(SETTINGS).complete(INPUT);

    expect(completion.usage).toEqual({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 0, thoughtTokens: 25 });
  });

  it("sums usage across tool rounds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [SEARCH_CALL] } }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { role: "assistant", content: "Có Panadol." } }],
          usage: { prompt_tokens: 150, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 } },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const completion = await new OpenAiCompatibleChatModel(SETTINGS).complete({
      ...INPUT,
      tools: [SEARCH_TOOL],
      runTool: async () => ({ products: [PANADOL] }),
    });

    expect(completion).toEqual({
      text: "Có Panadol.",
      usage: { inputTokens: 250, cachedInputTokens: 0, outputTokens: 25, thoughtTokens: 5 },
      modelCalls: 2,
    });
  });

  it("reports usage as undefined when any call came back without a usage block", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [SEARCH_CALL] } }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
      )
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { role: "assistant", content: "Xong." } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const completion = await new OpenAiCompatibleChatModel(SETTINGS).complete({
      ...INPUT,
      tools: [SEARCH_TOOL],
      runTool: async () => ({ products: [PANADOL] }),
    });

    expect(completion).toEqual({ text: "Xong.", usage: undefined, modelCalls: 2 });
  });

  it("reports empty content as a ChatModelError that names the finish reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({ choices: [{ message: { role: "assistant", content: "   " }, finish_reason: "length" }] }),
      ),
    );

    const failure = await new OpenAiCompatibleChatModel(SETTINGS).complete(INPUT).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(failure).toHaveProperty("message", "OpenAI-compatible API returned no text (finish reason length)");
  });

  it("reports null content as a ChatModelError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { role: "assistant", content: null } }] })),
    );

    const failure = await new OpenAiCompatibleChatModel(SETTINGS).complete(INPUT).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(failure).toHaveProperty("message", expect.stringMatching(/^OpenAI-compatible API returned no text/));
  });

  it("reports a provider failure without echoing the body, the conversation or the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () => new Response("test-key-1234 Bệnh nhân Nguyễn Văn A bị tiêu chảy", { status: 500 }),
      ),
    );

    const failure = await new OpenAiCompatibleChatModel(SETTINGS)
      .complete({ ...INPUT, turns: [{ role: "user", content: "tôi bị tiêu chảy" }] })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(failure).toHaveProperty("message", "OpenAI-compatible API answered HTTP 500");
  });

  it("reports a network failure as a ChatModelError with the cause attached", async () => {
    const cause = new TypeError("fetch failed");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw cause;
      }),
    );

    const failure = await new OpenAiCompatibleChatModel(SETTINGS).complete(INPUT).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(failure).toHaveProperty("cause", cause);
  });

  it("reports a response that is not JSON as a ChatModelError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 })),
    );

    await expect(new OpenAiCompatibleChatModel(SETTINGS).complete(INPUT)).rejects.toThrow(
      "OpenAI-compatible API returned a non-JSON response",
    );
  });

  it("reports a response of the wrong shape as a ChatModelError", async () => {
    const model = new OpenAiCompatibleChatModel(SETTINGS);

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json(null)),
    );
    await expect(model.complete(INPUT)).rejects.toThrow("OpenAI-compatible API returned an unexpected response shape");

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({ choices: [] })),
    );
    await expect(model.complete(INPUT)).rejects.toThrow("OpenAI-compatible API returned an unexpected response shape");

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { role: "assistant", content: 42 } }] })),
    );
    await expect(model.complete(INPUT)).rejects.toThrow("OpenAI-compatible API returned an unexpected response shape");

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "call-1", function: { name: "search_products", arguments: { query: "ho" } } }],
              },
            },
          ],
        }),
      ),
    );
    await expect(model.complete(INPUT)).rejects.toThrow("OpenAI-compatible API returned an unexpected response shape");
  });
});
