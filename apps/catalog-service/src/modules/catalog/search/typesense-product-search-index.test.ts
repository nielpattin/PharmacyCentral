import { afterEach, describe, expect, it, vi } from "vitest";
import { SEMANTIC_MAX_DISTANCE } from "./hybrid-search.ts";
import { SYMPTOM_SYNONYM_SET, TypesenseProductSearchIndex } from "./typesense-product-search-index.ts";
import type { SynonymSetItem } from "./product-search-index.ts";

const stubTypesenseHits = (hits: unknown[]): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ results: [{ hits }] }), { status: 200 })),
  );
};

const approvedSynonyms: SynonymSetItem[] = [{ id: "group-1", synonyms: ["tieu chay", "di ngoai"] }];
const index = new TypesenseProductSearchIndex({
  baseUrl: "http://typesense.test",
  apiKey: "test-key",
  loadSynonyms: async () => approvedSynonyms,
});

describe("TypesenseProductSearchIndex synonym set", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pushes the loaded approved items before it checks the collection", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        calls.push({
          method: init.method ?? "GET",
          url: url.toString(),
          body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    await index.ensureReady();

    expect(calls[0]).toEqual({
      method: "PUT",
      url: `http://typesense.test/synonym_sets/${SYMPTOM_SYNONYM_SET}`,
      body: { items: approvedSynonyms },
    });
  });

  it("sends an empty item list when nothing is approved, so the set still exists", async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        calls.push({
          method: init.method ?? "GET",
          body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const empty = new TypesenseProductSearchIndex({
      baseUrl: "http://typesense.test",
      apiKey: "test-key",
      loadSynonyms: async () => [],
    });

    await empty.syncSynonyms([]);

    expect(calls).toEqual([{ method: "PUT", body: { items: [] } }]);
  });
});

describe("TypesenseProductSearchIndex.search distance cut-off", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops vector-only hits beyond the distance limit and keeps keyword matches", async () => {
    stubTypesenseHits([
      { document: { id: "keyword-far" }, text_match: 1000, vector_distance: SEMANTIC_MAX_DISTANCE + 0.1 },
      { document: { id: "vector-near" }, text_match: 0, vector_distance: SEMANTIC_MAX_DISTANCE - 0.05 },
      { document: { id: "vector-far" }, text_match: 0, vector_distance: SEMANTIC_MAX_DISTANCE + 0.05 },
    ]);

    const ids = await index.search({ text: "hạ sốt", queryEmbedding: [0.1, 0.2], limit: 10 });

    expect(ids).toEqual(["keyword-far", "vector-near"]);
  });

  it("keeps every hit when the query has no embedding, because no vector branch ran", async () => {
    stubTypesenseHits([
      { document: { id: "keyword-only" }, text_match: 500 },
      { document: { id: "other" }, text_match: 0 },
    ]);

    const ids = await index.search({ text: "smecta", limit: 10 });

    expect(ids).toEqual(["keyword-only", "other"]);
  });
});

describe("TypesenseProductSearchIndex malformed upstream answers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a search hit without document.id", async () => {
    stubTypesenseHits([{ document: {}, text_match: 10 }]);

    await expect(index.search({ text: "smecta", limit: 10 })).rejects.toThrow("does not match the expected shape");
  });
});
