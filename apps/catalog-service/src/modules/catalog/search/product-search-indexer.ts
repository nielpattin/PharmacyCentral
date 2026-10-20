import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Logger } from "../../../logger.ts";
import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import { products } from "../../../shared/infrastructure/schema.ts";

import type { ProductSearchDocument, ProductSearchIndex } from "./product-search-index.ts";
import { buildEmbeddingText, foldSearchText } from "./search-text.ts";
import type { TextEmbedder, TextEmbedderSource } from "./text-embedder.ts";

const BATCH_SIZE = 50;
const LEXICAL_ONLY_MODEL = "lexical-only";

type ProductRecord = typeof products.$inferSelect;
type PreparedProduct = { document: ProductSearchDocument; embeddingText: string };

const optionalFolded = (value: string | null): string | undefined => {
  const folded = value ? foldSearchText(value) : "";
  return folded === "" ? undefined : folded;
};

const optionalText = (value: string | null): string | undefined => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
};

const toIndexRecord = (product: ProductRecord, model: string): PreparedProduct => {
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
    },
    embeddingText,
  };
};

export class ProductSearchIndexer {
  private readonly database: CatalogDatabase;
  private readonly index: ProductSearchIndex;
  private readonly embedders: TextEmbedderSource | undefined;
  private readonly logger: Logger;
  private inFlight: Promise<void> | undefined;
  private rerun = false;

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
   * Never rejects: sweep failures are logged and the drain always clears its in-flight state.
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
        try {
          await this.sweep();
        } catch (error) {
          this.logger.warn({ error }, "product search index sweep failed");
        }
      } while (this.rerun);
    } finally {
      this.inFlight = undefined;
    }
  }

  private async sweep(): Promise<void> {
    await this.index.ensureReady();
    const embedder = await this.embedders?.();
    const embeddingModel = embedder?.model ?? LEXICAL_ONLY_MODEL;
    const rows = await this.database.db.select().from(products).where(eq(products.isActive, true));
    const prepared = rows.map((row) => toIndexRecord(row, embeddingModel));
    const existing = await this.index.listContentHashes();

    const activeIds = new Set(prepared.map((item) => item.document.id));
    const changed = prepared.filter((item) => existing.get(item.document.id) !== item.document.contentHash);
    const stale = [...existing.keys()].filter((id) => !activeIds.has(id));

    const documents = await this.withEmbeddings(changed, embedder);
    for (let start = 0; start < documents.length; start += BATCH_SIZE) {
      await this.index.upsert(documents.slice(start, start + BATCH_SIZE));
    }
    await this.index.remove(stale);
    this.logger.info(
      { indexed: changed.length, removed: stale.length, unchanged: prepared.length - changed.length },
      "product search index sweep finished",
    );
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
