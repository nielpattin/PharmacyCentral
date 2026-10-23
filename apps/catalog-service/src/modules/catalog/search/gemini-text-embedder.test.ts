import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiTextEmbedder } from "./gemini-text-embedder.ts";
import { EMBEDDING_DIMENSIONS } from "./text-embedder.ts";

const unitVector = (scale = 0.5): number[] => {
  const raw = Array.from({ length: EMBEDDING_DIMENSIONS }, () => scale);
  const norm = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0));
  return raw.map((value) => value / norm);
};

const stubGemini = (payload: unknown, status = 200) => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const bodyOf = (init: RequestInit | undefined): string => {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("fetch body was not a JSON string");
  return body;
};

const SETTINGS = { baseUrl: "https://gemini.test", model: "gemini-test", apiKey: "bound-key-value-1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeminiTextEmbedder", () => {
  it("calls the bound model with the bound key on every query", async () => {
    const fetchMock = stubGemini({ embedding: { values: unitVector() } });
    const embedder = new GeminiTextEmbedder(SETTINGS);

    await embedder.embedQuery("ho");

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toEqual(new URL("https://gemini.test/v1beta/models/gemini-test:embedContent"));
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("bound-key-value-1");
    expect(JSON.parse(bodyOf(init))).toMatchObject({
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIMENSIONS,
    });
  });

  it("exposes the bound model name for the search index's content hash", () => {
    expect(new GeminiTextEmbedder(SETTINGS).model).toBe("gemini-test");
  });

  it("returns unit vectors of the expected dimension for a query", async () => {
    stubGemini({ embedding: { values: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 2) } });

    const vector = await new GeminiTextEmbedder(SETTINGS).embedQuery("ho");

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.hypot(...vector)).toBeCloseTo(1);
  });

  it("embeds documents in batches of 50 and returns one normalised vector per text", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(bodyOf(init)) as { requests: unknown[] };
      const embeddings = body.requests.map(() => ({ values: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 3) }));
      return new Response(JSON.stringify({ embeddings }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const texts = Array.from({ length: 51 }, (_, index) => `product ${index}`);

    const vectors = await new GeminiTextEmbedder(SETTINGS).embedDocuments(texts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const batchSizes = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(bodyOf(init)) as { requests: Array<{ taskType: string }> };
      expect(body.requests.every((request) => request.taskType === "RETRIEVAL_DOCUMENT")).toBe(true);
      return body.requests.length;
    });
    expect(batchSizes).toEqual([50, 1]);
    expect(vectors).toHaveLength(51);
    expect(vectors.every((vector) => Math.abs(Math.hypot(...vector) - 1) < 1e-9)).toBe(true);
  });

  it("rejects an embedding whose dimension differs from the index", async () => {
    stubGemini({ embedding: { values: [0.1, 0.2, 0.3] } });

    await expect(new GeminiTextEmbedder(SETTINGS).embedQuery("ho")).rejects.toThrow(`expected ${EMBEDDING_DIMENSIONS}`);
  });

  it("rejects a vector containing a non-number instead of returning NaN components", async () => {
    const values: unknown[] = unitVector();
    values[0] = "0.5";
    stubGemini({ embedding: { values } });

    await expect(new GeminiTextEmbedder(SETTINGS).embedQuery("ho")).rejects.toThrow(
      "does not match the expected shape",
    );
  });
});
