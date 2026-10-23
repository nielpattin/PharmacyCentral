import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleTextEmbedder } from "./openai-compatible-text-embedder.ts";
import { EMBEDDING_DIMENSIONS } from "./text-embedder.ts";

const vectorOf = (value: number): number[] => Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);

const stubServer = (respond: (input: string[]) => unknown, status = 200) => {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return new Response(JSON.stringify(respond(body.input)), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const inputsOf = (fetchMock: ReturnType<typeof stubServer>, call: number): string[] =>
  (JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)) as { input: string[] }).input;

const echoServer = (input: string[]) => ({ data: input.map((_text, index) => ({ index, embedding: vectorOf(1) })) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAiCompatibleTextEmbedder", () => {
  it("keeps the version path of the base URL and sends the key as a bearer token", async () => {
    const fetchMock = stubServer(echoServer);

    await new OpenAiCompatibleTextEmbedder({
      baseUrl: "http://embedder:3000/v1/",
      model: "some-model",
      apiKey: "bound-key-value-1",
    }).embedQuery("ho");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://embedder:3000/v1/embeddings");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer bound-key-value-1");
  });

  it("gives E5 models their query and passage prefixes and other models the text as it is", async () => {
    const e5 = stubServer(echoServer);
    const e5Embedder = new OpenAiCompatibleTextEmbedder({
      baseUrl: "http://e",
      model: "intfloat/multilingual-e5-base",
      apiKey: "bound-key-value-1",
    });
    await e5Embedder.embedQuery("đau đầu");
    await e5Embedder.embedDocuments(["Paracetamol"]);
    expect(inputsOf(e5, 0)).toEqual(["query: đau đầu"]);
    expect(inputsOf(e5, 1)).toEqual(["passage: Paracetamol"]);

    const plain = stubServer(echoServer);
    await new OpenAiCompatibleTextEmbedder({
      baseUrl: "http://e",
      model: "text-embedding-3-small",
      apiKey: "bound-key-value-1",
    }).embedQuery("đau đầu");
    expect(inputsOf(plain, 0)).toEqual(["đau đầu"]);
  });

  it("returns vectors in input order even when the server answers out of order", async () => {
    const axis = (position: number): number[] =>
      Array.from({ length: EMBEDDING_DIMENSIONS }, (_unused, at) => (at === position ? 5 : 0));
    stubServer((input) => ({
      data: input.map((_text, index) => ({ index, embedding: axis(index) })).reverse(),
    }));

    const vectors = await new OpenAiCompatibleTextEmbedder({
      baseUrl: "http://e",
      model: "m",
      apiKey: "bound-key-value-1",
    }).embedDocuments(["a", "b"]);

    expect(vectors[0]?.[0]).toBeCloseTo(1);
    expect(vectors[1]?.[1]).toBeCloseTo(1);
  });

  it("cuts vector-only hits at a model-specific distance: tighter for E5, whose vectors sit close together", () => {
    const options = { baseUrl: "http://e", apiKey: "bound-key-value-1" };

    expect(
      new OpenAiCompatibleTextEmbedder({ ...options, model: "intfloat/multilingual-e5-small" }).maxVectorDistance,
    ).toBe(0.15);
    expect(new OpenAiCompatibleTextEmbedder({ ...options, model: "text-embedding-3-small" }).maxVectorDistance).toBe(
      0.35,
    );
  });

  it("sends documents in batches of 32", async () => {
    const fetchMock = stubServer(echoServer);

    const vectors = await new OpenAiCompatibleTextEmbedder({
      baseUrl: "http://e",
      model: "m",
      apiKey: "bound-key-value-1",
    }).embedDocuments(Array.from({ length: 70 }, (_unused, index) => `p${index}`));

    expect(vectors).toHaveLength(70);
    expect(fetchMock.mock.calls.map((_call, call) => inputsOf(fetchMock, call).length)).toEqual([32, 32, 6]);
  });

  it("fails without echoing the provider body on an HTTP error or a wrong vector size", async () => {
    stubServer(() => ({ error: "secret prompt echoed back" }), 429);
    const embedder = new OpenAiCompatibleTextEmbedder({ baseUrl: "http://e", model: "m", apiKey: "bound-key-value-1" });
    await expect(embedder.embedQuery("ho")).rejects.toThrow("status 429");

    stubServer(() => ({ data: [{ index: 0, embedding: [0.1, 0.2] }] }));
    await expect(embedder.embedQuery("ho")).rejects.toThrow(/expected shape at data\.0\.embedding/);
  });
});
