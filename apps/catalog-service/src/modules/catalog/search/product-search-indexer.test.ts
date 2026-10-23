import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Logger } from "../../../logger.ts";
import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import { productUnits } from "../../../shared/infrastructure/schema.ts";
import { EMBEDDING_DIMENSIONS, type TextEmbedder, type TextEmbedderSource } from "./text-embedder.ts";

import { ProductSearchIndexer } from "./product-search-indexer.ts";
import type { ProductSearchDocument, ProductSearchIndex } from "./product-search-index.ts";
import { TypesenseProductSearchIndex } from "./typesense-product-search-index.ts";

const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_PRODUCT_ID = "00000000-0000-4000-8000-000000000003";

const productRecord = {
  id: PRODUCT_ID,
  sku: "PTH-001",
  barcode: null,
  name: "Dạ dày ngọc Thu",
  genericName: null,
  activeIngredient: null,
  indications: null,
  category: null,
  prescriptionRequired: false,
  dosageForm: null,
  isActive: true,
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
  updatedAt: new Date("2026-01-02T03:04:05.000Z"),
};

const vector = (): number[] => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1 / EMBEDDING_DIMENSIONS);

const unit = (productId: string, unitName: string, sortOrder: number, conversionFactor = "1.000000") => ({
  id: `${productId}-${sortOrder}`,
  productId,
  unitName,
  conversionFactorToBaseUnit: conversionFactor,
  isBaseUnit: sortOrder === 0,
  isDefaultSaleUnit: sortOrder === 0,
  isDefaultPurchaseUnit: sortOrder === 0,
  barcode: null,
  sortOrder,
});

const logInfo = vi.fn<() => void>();
const logWarn = vi.fn<(reason: { error: unknown }, message: string) => void>();
const logger = { info: logInfo, warn: logWarn, error: vi.fn() } as unknown as Logger;

/** Answers the product query with `rows` and the units query with `units`, which the caller supplies in query order. */
const database = (rows: unknown[], units: unknown[] = [], onUnitQuery: () => void = () => undefined): CatalogDatabase =>
  ({
    db: {
      select: () => ({
        from: (table: unknown) =>
          table === productUnits
            ? {
                where: () => ({
                  orderBy: () => {
                    onUnitQuery();
                    return Promise.resolve(units);
                  },
                }),
              }
            : { where: () => Promise.resolve(rows) },
      }),
    },
    pool: undefined,
  }) as unknown as CatalogDatabase;

const statefulIndex = (): {
  index: ProductSearchIndex;
  upsert: Mock<(documents: ProductSearchDocument[]) => Promise<void>>;
} => {
  const hashes = new Map<string, string>();
  const upsert = vi.fn<(documents: ProductSearchDocument[]) => Promise<void>>(async (documents) => {
    for (const document of documents) hashes.set(document.id, document.contentHash);
  });
  const index: ProductSearchIndex = {
    ensureReady: async () => undefined,
    listContentHashes: async () => new Map(hashes),
    upsert,
    remove: async () => undefined,
    search: async () => ({ ids: [], hasMore: false }),
  };
  return { index, upsert };
};

const createEmbedder = (
  model = "test-embedding-model",
): { embedder: TextEmbedder; embedDocuments: Mock<(texts: string[]) => Promise<number[][]>> } => {
  const embedDocuments = vi.fn<(texts: string[]) => Promise<number[][]>>(async (texts) => texts.map(() => vector()));
  const embedder: TextEmbedder = { model, maxVectorDistance: 0.35, embedDocuments, embedQuery: async () => vector() };
  return { embedder, embedDocuments };
};

const runSweep = async (indexer: ProductSearchIndexer): Promise<void> => {
  await indexer.requestSweep();
};

const indexerWith = (
  index: ProductSearchIndex,
  embedders: TextEmbedderSource | undefined,
  source: CatalogDatabase = database([productRecord]),
): ProductSearchIndexer => new ProductSearchIndexer({ database: source, index, embedders, logger });

describe("ProductSearchIndexer", () => {
  it("writes lexical-only documents and does not embed while no provider settings are configured", async () => {
    const { index, upsert } = statefulIndex();

    await runSweep(indexerWith(index, async () => undefined));

    const batch = (upsert.mock.calls[0]?.[0] ?? []) as ProductSearchDocument[];
    expect(batch.length).toBe(1);
    expect(batch[0]?.embedding).toBeUndefined();
  });

  it("indexes each product with its GET /products body, units in query order, one units query per batch", async () => {
    const { index, upsert } = statefulIndex();
    const onUnitQuery = vi.fn<() => void>();
    const second = { ...productRecord, id: OTHER_PRODUCT_ID, sku: "PTH-002", name: "Paracetamol 500mg" };
    // The units arrive in the order the query returns them: by sort order, across products.
    const units = [
      unit(PRODUCT_ID, "Hộp", 0, "10.000000"),
      unit(OTHER_PRODUCT_ID, "Vỉ", 0),
      unit(PRODUCT_ID, "Viên", 1),
    ];
    const indexer = new ProductSearchIndexer({
      database: database([productRecord, second], units, onUnitQuery),
      index,
      embedders: undefined,
      logger,
    });

    await runSweep(indexer);

    const batch = (upsert.mock.calls[0]?.[0] ?? []) as ProductSearchDocument[];
    const byId = new Map(batch.map((document) => [document.id, document]));
    expect(onUnitQuery).toHaveBeenCalledTimes(1);
    expect(byId.get(PRODUCT_ID)?.payload).toBe(JSON.stringify({ ...productRecord, units: [units[0], units[2]] }));
    expect(byId.get(PRODUCT_ID)?.payload).toContain('"createdAt":"2026-01-02T03:04:05.000Z"');
    expect(byId.get(OTHER_PRODUCT_ID)?.payload).toBe(JSON.stringify({ ...second, units: [units[1]] }));
  });

  it("re-indexes a product when one of its units changes, and not while the units stay the same", async () => {
    const { index, upsert } = statefulIndex();
    const before = [unit(PRODUCT_ID, "Hộp", 0, "10.000000")];
    const after = [unit(PRODUCT_ID, "Hộp", 0, "12.000000")];

    await runSweep(indexerWith(index, undefined, database([productRecord], before)));
    await runSweep(indexerWith(index, undefined, database([productRecord], before)));
    expect(upsert).toHaveBeenCalledTimes(1);

    await runSweep(indexerWith(index, undefined, database([productRecord], after)));
    expect(upsert).toHaveBeenCalledTimes(2);
    const [first, changed] = upsert.mock.calls.map(([batch]) => batch[0]);
    expect(changed?.payload).not.toBe(first?.payload);
    expect(changed?.contentHash).not.toBe(first?.contentHash);
  });

  it("re-indexes a product when a display field outside the search text changes", async () => {
    const { index, upsert } = statefulIndex();

    await runSweep(indexerWith(index, undefined));
    await runSweep(indexerWith(index, undefined, database([{ ...productRecord, notes: "Bảo quản nơi khô ráo" }])));

    expect(upsert).toHaveBeenCalledTimes(2);
    const [first, changed] = upsert.mock.calls.map(([batch]) => batch[0]);
    expect(changed?.contentHash).not.toBe(first?.contentHash);
  });

  it("resolves the embedder once per sweep and embeds changed products with that same instance", async () => {
    const { index, upsert } = statefulIndex();
    const { embedder, embedDocuments } = createEmbedder();
    const embedders = vi.fn<TextEmbedderSource>(async () => embedder);

    await runSweep(indexerWith(index, embedders));

    expect(embedders).toHaveBeenCalledTimes(1);
    expect(embedDocuments).toHaveBeenCalledTimes(1);
    const batch = (upsert.mock.calls[0]?.[0] ?? []) as ProductSearchDocument[];
    expect(batch.length).toBe(1);
    expect((batch[0]?.embedding ?? []).length).toBe(EMBEDDING_DIMENSIONS);
  });

  it("re-embeds every product when the resolved model changes, and not while it stays the same", async () => {
    const { index, upsert } = statefulIndex();
    const first = createEmbedder("model-a");
    const second = createEmbedder("model-b");
    let current = first.embedder;
    const indexer = indexerWith(index, async () => current);

    await runSweep(indexer);
    await runSweep(indexer);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(first.embedDocuments).toHaveBeenCalledTimes(1);

    current = second.embedder;
    await runSweep(indexer);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(second.embedDocuments).toHaveBeenCalledTimes(1);
  });

  it("indexes products for keyword search when the embedder fails, then gives them vectors on the retry", async () => {
    vi.useFakeTimers();
    try {
      const { index, upsert } = statefulIndex();
      const { embedder, embedDocuments } = createEmbedder();
      embedDocuments.mockRejectedValueOnce(new Error("Gemini embedding request failed with status 429"));
      const indexer = indexerWith(index, async () => embedder);

      await runSweep(indexer);

      const keywordOnly = (upsert.mock.calls[0]?.[0] ?? []) as ProductSearchDocument[];
      expect(keywordOnly.map((document) => document.id)).toEqual([PRODUCT_ID]);
      expect(keywordOnly[0]?.embedding).toBeUndefined();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(embedDocuments).toHaveBeenCalledTimes(2);
      const withVector = (upsert.mock.calls[1]?.[0] ?? []) as ProductSearchDocument[];
      expect((withVector[0]?.embedding ?? []).length).toBe(EMBEDDING_DIMENSIONS);
      expect(withVector[0]?.contentHash).not.toBe(keywordOnly[0]?.contentHash);

      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(embedDocuments).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed sweep with a doubling delay and stops once a sweep completes", async () => {
    vi.useFakeTimers();
    try {
      const { index } = statefulIndex();
      const ensureReady = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("typesense down"))
        .mockRejectedValueOnce(new Error("typesense down"))
        .mockResolvedValue(undefined);
      const indexer = indexerWith({ ...index, ensureReady }, undefined);

      await runSweep(indexer);
      expect(ensureReady).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(29_000);
      expect(ensureReady).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ensureReady).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(59_000);
      expect(ensureReady).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ensureReady).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(ensureReady).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a settings read failure as a sweep failure instead of vectorless writing", async () => {
    const { index, upsert } = statefulIndex();
    const indexer = indexerWith(index, async () => {
      throw new Error("The stored secret cannot be decrypted with the current master key.");
    });

    await runSweep(indexer);

    expect(upsert).not.toHaveBeenCalled();
    const [logged, message] = logWarn.mock.calls.at(-1) ?? [];
    expect(logged?.error).toBeInstanceOf(Error);
    expect(message).toBe("product search index sweep failed");
  });
});

describe("ProductSearchIndexer with the Typesense index", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts the sweep on an invalid export line before any stale-removal DELETE is sent", async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname.endsWith("/documents/export")) {
        return new Response('{"id":"p-1","content_hash":"h-1"}\nnot-json-at-all\n', { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const index = new TypesenseProductSearchIndex({
      baseUrl: "http://typesense.test",
      apiKey: "test-key",
      loadSynonyms: async () => [],
    });

    await runSweep(indexerWith(index, undefined));

    const [logged, message] = logWarn.mock.calls.at(-1) ?? [];
    expect(message).toBe("product search index sweep failed");
    expect(String(logged?.error)).toContain("not valid JSON");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});
