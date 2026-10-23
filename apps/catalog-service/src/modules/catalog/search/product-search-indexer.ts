import { createHash } from "node:crypto";

import { asc, eq, inArray } from "drizzle-orm";

import type { Logger } from "../../../logger.ts";
import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import { productUnits, products } from "../../../shared/infrastructure/schema.ts";

import type { ProductSearchDocument, ProductSearchIndex } from "./product-search-index.ts";
import { buildEmbeddingText, foldSearchText } from "./search-text.ts";
import type { TextEmbedder, TextEmbedderSource } from "./text-embedder.ts";

const BATCH_SIZE = 50;
const LEXICAL_ONLY_MODEL = "lexical-only";
// A failed sweep tries again after this long, doubling up to the cap, until one completes.
const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

type ProductRecord = typeof products.$inferSelect;
type UnitRecord = typeof productUnits.$inferSelect;
/** A product with the body `GET /products` returns for it. The search service serves that body from the payload. */
type SourceProduct = { row: ProductRecord; payload: string };
type PreparedProduct = { document: ProductSearchDocument; embeddingText: string; source: SourceProduct };

const optionalFolded = (value: string | null): string | undefined => {
  const folded = value ? foldSearchText(value) : "";
  return folded === "" ? undefined : folded;
};

const optionalText = (value: string | null): string | undefined => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
};

/** The units of each product, in the order `DrizzleStoreRepository.listUnitsByProductIds` returns them. */
const listUnitsByProductIds = async (
  database: CatalogDatabase,
  productIds: string[],
): Promise<Map<string, UnitRecord[]>> => {
  const byProduct = new Map<string, UnitRecord[]>(productIds.map((id) => [id, []]));
  const rows = await database.db
    .select()
    .from(productUnits)
    .where(inArray(productUnits.productId, productIds))
    .orderBy(asc(productUnits.sortOrder));
  for (const row of rows) byProduct.get(row.productId)?.push(row);
  return byProduct;
};

/** Builds the `GET /products` body of each product. One units query covers each batch of products. */
const loadSourceProducts = async (database: CatalogDatabase, rows: ProductRecord[]): Promise<SourceProduct[]> => {
  const sources: SourceProduct[] = [];
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const units = await listUnitsByProductIds(
      database,
      batch.map((row) => row.id),
    );
    for (const row of batch) {
      sources.push({ row, payload: JSON.stringify({ ...row, units: units.get(row.id) ?? [] }) });
    }
  }
  return sources;
};

const toIndexRecord = (source: SourceProduct, model: string): PreparedProduct => {
  const { row: product, payload } = source;
  const nameFolded = foldSearchText(product.name);
  const genericNameFolded = optionalFolded(product.genericName);
  const activeIngredientFolded = optionalFolded(product.activeIngredient);
  const indicationsFolded = optionalFolded(product.indications);
  const barcode = optionalText(product.barcode);
  const category = optionalText(product.category);
  const embeddingText = buildEmbeddingText({
    name: product.name,
    category,
    activeIngredient: product.activeIngredient,
    indications: product.indications,
    dosageForm: product.dosageForm,
  });
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify([
        model,
        product.sku,
        barcode,
        nameFolded,
        genericNameFolded,
        activeIngredientFolded,
        indicationsFolded,
        category,
        product.prescriptionRequired,
        embeddingText,
        payload,
      ]),
    )
    .digest("hex");
  return {
    document: {
      id: product.id,
      sku: product.sku,
      barcode,
      nameFolded,
      genericNameFolded,
      activeIngredientFolded,
      indicationsFolded,
      category,
      prescriptionRequired: product.prescriptionRequired,
      contentHash,
      payload,
    },
    embeddingText,
    source,
  };
};

export class ProductSearchIndexer {
  private readonly database: CatalogDatabase;
  private readonly index: ProductSearchIndex;
  private readonly embedders: TextEmbedderSource | undefined;
  private readonly logger: Logger;
  private inFlight: Promise<void> | undefined;
  private rerun = false;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryDelayMs = RETRY_MIN_MS;

  public constructor(options: {
    database: CatalogDatabase;
    index: ProductSearchIndex;
    embedders?: TextEmbedderSource | undefined;
    logger: Logger;
  }) {
    this.database = options.database;
    this.index = options.index;
    this.embedders = options.embedders;
    this.logger = options.logger;
  }

  /**
   * Starts a sweep, or marks a running one to run again. Resolves when the drain that covers this request finishes.
   * Never rejects: sweep failures are logged and the drain always clears its in-flight state. A sweep that fails, or
   * that had to index products without vectors, schedules its own retry with a growing delay.
   */
  public requestSweep(): Promise<void> {
    if (this.inFlight) {
      this.rerun = true;
      return this.inFlight;
    }
    this.inFlight = this.drain();
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.rerun = false;
        let complete = false;
        try {
          complete = await this.sweep();
        } catch (error) {
          this.logger.warn({ error }, "product search index sweep failed");
        }
        if (complete) this.clearRetry();
        else this.scheduleRetry();
      } while (this.rerun);
    } finally {
      this.inFlight = undefined;
    }
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retryDelayMs = RETRY_MIN_MS;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(delay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.requestSweep();
    }, delay);
    // A pending retry must not keep the process alive on shutdown.
    this.retryTimer.unref();
  }

  /** Resolves true when every product is indexed with the vectors the configured embedder should give it. */
  private async sweep(): Promise<boolean> {
    await this.index.ensureReady();
    const embedder = await this.embedders?.();
    const embeddingModel = embedder?.model ?? LEXICAL_ONLY_MODEL;
    const rows = await this.database.db.select().from(products).where(eq(products.isActive, true));
    const sources = await loadSourceProducts(this.database, rows);
    const prepared = sources.map((source) => toIndexRecord(source, embeddingModel));
    const existing = await this.index.listContentHashes();

    const activeIds = new Set(prepared.map((item) => item.document.id));
    const changed = prepared.filter((item) => existing.get(item.document.id) !== item.document.contentHash);
    const stale = [...existing.keys()].filter((id) => !activeIds.has(id));

    let embedded = true;
    let documents: ProductSearchDocument[];
    try {
      documents = await this.withEmbeddings(changed, embedder);
    } catch (error) {
      // A provider outage (quota, timeout, bad answer) must not leave products out of search. Index them for keyword
      // search; their lexical-only hash differs from the embedded one, so a later sweep gives them vectors.
      this.logger.warn({ error }, "embedding failed, indexing products for keyword search only");
      embedded = false;
      documents = changed
        .map((item) => toIndexRecord(item.source, LEXICAL_ONLY_MODEL).document)
        .filter((document) => existing.get(document.id) !== document.contentHash);
    }
    for (let start = 0; start < documents.length; start += BATCH_SIZE) {
      await this.index.upsert(documents.slice(start, start + BATCH_SIZE));
    }
    await this.index.remove(stale);
    this.logger.info(
      { indexed: changed.length, removed: stale.length, unchanged: prepared.length - changed.length },
      "product search index sweep finished",
    );
    return embedded;
  }

  private async withEmbeddings(
    changed: PreparedProduct[],
    embedder: TextEmbedder | undefined,
  ): Promise<ProductSearchDocument[]> {
    if (!embedder || changed.length === 0) return changed.map((item) => item.document);
    const vectors = await embedder.embedDocuments(changed.map((item) => item.embeddingText));
    if (vectors.length !== changed.length) {
      throw new Error(`Embedder returned ${vectors.length} vectors for ${changed.length} products`);
    }
    return changed.map((item, index) => ({ ...item.document, embedding: vectors[index] }));
  }
}
