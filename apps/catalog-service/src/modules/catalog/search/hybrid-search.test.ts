import { describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS, type TextEmbedder } from "./text-embedder.ts";

import { embedSearchQuery, searchCatalogProducts, SEMANTIC_MIN_WORDS } from "./hybrid-search.ts";
import type { ProductSearchIndex } from "./product-search-index.ts";

const vector = (): number[] => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1 / EMBEDDING_DIMENSIONS);

const embedder = (overrides: Partial<TextEmbedder>): TextEmbedder => ({
  model: "test-embedding-model",
  maxVectorDistance: 0.4,
  embedDocuments: async () => [],
  embedQuery: async () => vector(),
  ...overrides,
});

describe("embedSearchQuery", () => {
  it("answers keyword-only without a warning while no provider settings are configured", async () => {
    const warn = vi.fn<(error: unknown) => void>();

    const embedding = await embedSearchQuery(async () => undefined, "viên hạ sốt", warn);

    expect(embedding).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the query embedding from the embedder the source resolved", async () => {
    const embedQuery = vi.fn<() => Promise<number[]>>(async () => vector());
    const resolved = embedder({ embedQuery });
    const source = vi.fn(async () => resolved);

    expect(await embedSearchQuery(source, "viên hạ sốt")).toEqual({ embedding: vector(), maxDistance: 0.4 });
    expect(source).toHaveBeenCalledTimes(1);
    expect(embedQuery).toHaveBeenCalledWith("viên hạ sốt");
  });

  it("resolves no settings for a blank search", async () => {
    const source = vi.fn(async () => embedder({}));

    expect(await embedSearchQuery(source, "   ")).toBeUndefined();
    expect(source).not.toHaveBeenCalled();
  });

  it("answers keyword-only when no source is wired at all", async () => {
    expect(await embedSearchQuery(undefined, "viên hạ sốt")).toBeUndefined();
  });

  it("surfaces a settings read failure instead of silently skipping the semantic branch", async () => {
    const warn = vi.fn<(error: unknown) => void>();
    const source = async (): Promise<TextEmbedder | undefined> => {
      throw new Error("The stored secret cannot be decrypted with the current master key.");
    };

    await expect(embedSearchQuery(source, "viên hạ sốt", warn)).rejects.toThrow("cannot be decrypted");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("searchCatalogProducts semantic branch", () => {
  const searchWith = async (search: string) => {
    const embedQuery = vi.fn(async () => vector());
    const indexSearch = vi.fn<ProductSearchIndex["search"]>(async () => ({ ids: [], hasMore: false }));
    const index = { search: indexSearch } as unknown as ProductSearchIndex;
    const repository = { searchProducts: vi.fn(), listActiveProductsByIds: vi.fn(async () => []) };
    await searchCatalogProducts(
      { repository, index, embedders: async () => embedder({ embedQuery }) },
      { search, limit: 20, offset: 0 },
    );
    return { embedQuery, indexSearch };
  };

  it("embeds a query of at least SEMANTIC_MIN_WORDS words and hands the vector to the index", async () => {
    const { embedQuery, indexSearch } = await searchWith("thuốc cho bé bị sốt");

    expect(SEMANTIC_MIN_WORDS).toBeLessThanOrEqual(5);
    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(indexSearch.mock.calls[0]?.[0].semantic).toBeDefined();
  });

  it("searches a shorter query by keywords alone, without calling the embedder", async () => {
    const { embedQuery, indexSearch } = await searchWith("đau   đầu");

    expect(embedQuery).not.toHaveBeenCalled();
    expect(indexSearch.mock.calls[0]?.[0].semantic).toBeUndefined();
  });
});
