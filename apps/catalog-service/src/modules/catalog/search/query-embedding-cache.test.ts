import { describe, expect, it, vi } from "vitest";

import { withQueryEmbeddingCache } from "./query-embedding-cache.ts";
import type { TextEmbedder } from "./text-embedder.ts";

const embedderOf = (
  model: string,
): { embedder: TextEmbedder; embedQuery: ReturnType<typeof vi.fn<(text: string) => Promise<number[]>>> } => {
  const embedQuery = vi.fn<(text: string) => Promise<number[]>>(async (text) => [text.length]);
  return {
    embedder: { model, maxVectorDistance: 0.2, embedDocuments: async (texts) => texts.map(() => [0]), embedQuery },
    embedQuery,
  };
};

describe("withQueryEmbeddingCache", () => {
  it("embeds a repeated query once and keeps the model's distance limit", async () => {
    const { embedder, embedQuery } = embedderOf("model-a");
    const cached = withQueryEmbeddingCache(async () => embedder);

    const first = await cached();
    expect(await first?.embedQuery("đau đầu")).toEqual([7]);
    expect(await (await cached())?.embedQuery("đau đầu")).toEqual([7]);

    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(first?.maxVectorDistance).toBe(0.2);
  });

  it("does not reuse a vector after the resolved model changes", async () => {
    const a = embedderOf("model-a");
    const b = embedderOf("model-b");
    let current = a.embedder;
    const cached = withQueryEmbeddingCache(async () => current);

    await (await cached())?.embedQuery("ho");
    current = b.embedder;
    await (await cached())?.embedQuery("ho");

    expect(a.embedQuery).toHaveBeenCalledTimes(1);
    expect(b.embedQuery).toHaveBeenCalledTimes(1);
  });

  it("drops the least recently used query once it holds more than the limit", async () => {
    const { embedder, embedQuery } = embedderOf("model-a");
    const cached = withQueryEmbeddingCache(async () => embedder, 2);
    const embed = async (text: string) => (await cached())?.embedQuery(text);

    await embed("a");
    await embed("b");
    await embed("a"); // refreshes "a", so "b" is now the oldest
    await embed("c");
    await embed("a");
    await embed("b");

    expect(embedQuery.mock.calls.map(([text]) => text)).toEqual(["a", "b", "c", "b"]);
  });

  it("leaves no embedder as no embedder and never caches a failed query", async () => {
    expect(await withQueryEmbeddingCache(async () => undefined)()).toBeUndefined();

    const { embedder, embedQuery } = embedderOf("model-a");
    embedQuery.mockRejectedValueOnce(new Error("429"));
    const cached = withQueryEmbeddingCache(async () => embedder);
    await expect((await cached())?.embedQuery("ho")).rejects.toThrow("429");
    expect(await (await cached())?.embedQuery("ho")).toEqual([2]);
  });
});
