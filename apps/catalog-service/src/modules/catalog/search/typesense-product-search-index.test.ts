import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCT_SEARCH_COLLECTION,
  SYMPTOM_SYNONYM_SET,
  TypesenseProductSearchIndex,
} from "./typesense-product-search-index.ts";
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

const SEMANTIC_MAX_DISTANCE = 0.2;

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

    const { ids } = await index.search({
      text: "hạ sốt",
      semantic: { embedding: [0.1, 0.2], maxDistance: SEMANTIC_MAX_DISTANCE },
      limit: 10,
      offset: 0,
    });

    expect(ids).toEqual(["keyword-far", "vector-near"]);
  });

  it("keeps every hit when the query has no embedding, because no vector branch ran", async () => {
    stubTypesenseHits([
      { document: { id: "keyword-only" }, text_match: 500 },
      { document: { id: "other" }, text_match: 0 },
    ]);

    const { ids } = await index.search({ text: "smecta", limit: 10, offset: 0 });

    expect(ids).toEqual(["keyword-only", "other"]);
  });

  it("reports another page only when the index ranks a hit beyond the page, and keeps the page to its size", async () => {
    stubTypesenseHits([
      { document: { id: "first" }, text_match: 500 },
      { document: { id: "second" }, text_match: 400 },
      { document: { id: "third" }, text_match: 300 },
    ]);

    const page = await index.search({ text: "smecta", limit: 2, offset: 0 });
    const last = await index.search({ text: "smecta", limit: 3, offset: 0 });

    expect(page).toEqual({ ids: ["first", "second"], hasMore: true });
    expect(last).toEqual({ ids: ["first", "second", "third"], hasMore: false });
  });
});

describe("TypesenseProductSearchIndex malformed upstream answers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a search hit without document.id", async () => {
    stubTypesenseHits([{ document: {}, text_match: 10 }]);

    await expect(index.search({ text: "smecta", limit: 10, offset: 0 })).rejects.toThrow(
      "does not match the expected shape",
    );
  });
});

describe("TypesenseProductSearchIndex collection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the v3 collection name", () => {
    expect(PRODUCT_SEARCH_COLLECTION).toBe("catalog_products_v3");
  });

  it("creates the collection with a sortable sku and an unindexed payload field", async () => {
    const created: Array<{ name: string; fields: Array<Record<string, unknown>> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        if (init.method === "POST" && url.pathname === "/collections") {
          created.push(JSON.parse(String(init.body)));
          return new Response("{}", { status: 201 });
        }
        if (init.method === "GET") return new Response("{}", { status: 404 });
        return new Response("{}", { status: 200 });
      }),
    );

    await index.ensureReady();

    expect(created).toHaveLength(1);
    expect(created[0]?.name).toBe("catalog_products_v3");
    const fields = created[0]?.fields ?? [];
    expect(fields.find((field) => field.name === "sku")).toEqual({ name: "sku", type: "string", sort: true });
    expect(fields.find((field) => field.name === "payload")).toEqual({
      name: "payload",
      type: "string",
      index: false,
      optional: true,
    });
  });
});

describe("TypesenseProductSearchIndex documents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the payload with the document fields in the import", async () => {
    const imported: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname === `/collections/${PRODUCT_SEARCH_COLLECTION}/documents/import`) {
          imported.push(String(init.body));
          return new Response(`${JSON.stringify({ success: true })}\n`, { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    const payload = JSON.stringify({ id: "p-1", sku: "PTH-001", units: [] });

    await index.upsert([
      {
        id: "p-1",
        sku: "PTH-001",
        nameFolded: "dau bung",
        prescriptionRequired: false,
        contentHash: "hash-1",
        payload,
      },
    ]);

    expect(imported).toHaveLength(1);
    expect(JSON.parse(imported[0] ?? "")).toEqual({
      id: "p-1",
      sku: "PTH-001",
      name_folded: "dau bung",
      prescription_required: false,
      content_hash: "hash-1",
      payload,
    });
  });
});
