import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Logger } from "../../../logger.ts";
import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import { EMBEDDING_DIMENSIONS, type TextEmbedder, type TextEmbedderSource } from "./text-embedder.ts";

import { ProductSearchIndexer } from "./product-search-indexer.ts";
import type { ProductSearchDocument, ProductSearchIndex } from "./product-search-index.ts";
import { TypesenseProductSearchIndex } from "./typesense-product-search-index.ts";

const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";

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
};

const vector = (): number[] => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1 / EMBEDDING_DIMENSIONS);

const logInfo = vi.fn<() => void>();
const logWarn = vi.fn<(reason: { error: unknown }, message: string) => void>();
const logger = { info: logInfo, warn: logWarn, error: vi.fn() } as unknown as Logger;

const database = (rows: unknown[]): CatalogDatabase =>
  ({
    db: { select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }) },
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
    search: async () => [],
  };
  return { index, upsert };
};

const createEmbedder = (
  model = "test-embedding-model",
): { embedder: TextEmbedder; embedDocuments: Mock<(texts: string[]) => Promise<number[][]>> } => {
  const embedDocuments = vi.fn<(texts: string[]) => Promise<number[][]>>(async (texts) => texts.map(() => vector()));
  const embedder: TextEmbedder = { model, embedDocuments, embedQuery: async () => vector() };
  return { embedder, embedDocuments };
};

const runSweep = async (indexer: ProductSearchIndexer): Promise<void> => {
  await indexer.requestSweep();
};

const indexerWith = (index: ProductSearchIndex, embedders: TextEmbedderSource | undefined): ProductSearchIndexer =>
  new ProductSearchIndexer({ database: database([productRecord]), index, embedders, logger });

describe("ProductSearchIndexer", () => {
  it("writes lexical-only documents and does not embed while no provider settings are configured", async () => {
    const { index, upsert } = statefulIndex();

    await runSweep(indexerWith(index, async () => undefined));

    const batch = (upsert.mock.calls[0]?.[0] ?? []) as ProductSearchDocument[];
    expect(batch.length).toBe(1);
    expect(batch[0]?.embedding).toBeUndefined();
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
