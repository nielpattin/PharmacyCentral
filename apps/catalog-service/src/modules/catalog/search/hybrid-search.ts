import type { products } from "../../../shared/infrastructure/schema.ts";
import type { DrizzleStoreRepository } from "../../stores/infrastructure/drizzle-store-repository.ts";

import { SearchIndexMissingError, type ProductSearchIndex, type ProductSearchRequest } from "./product-search-index.ts";
import type { TextEmbedderSource } from "./text-embedder.ts";

/**
 * Weight of the vector branch in Typesense hybrid rank fusion. Typesense defaults to 0.3.
 */
export const SEMANTIC_ALPHA = 0.3;

const MAX_LIMIT = 100;

/**
 * A query with fewer words searches by keywords alone and is never embedded. Short queries ("ho", "đau đầu",
 * "paracetamol") are what shoppers repeat, and the keyword fields already cover them; the vector branch earns its
 * cost on longer, free-form queries ("thuốc cho bé bị sốt về đêm").
 */
export const SEMANTIC_MIN_WORDS = 3;

const wordCount = (text: string): number => text.trim().split(/\s+/).length;

export type ProductSearchQuery = {
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  category?: string | undefined;
  prescriptionRequired?: boolean | undefined;
};

export type ProductSearchRepository = Pick<DrizzleStoreRepository, "searchProducts" | "listActiveProductsByIds">;

export type ProductSearchDependencies = {
  repository: ProductSearchRepository;
  index: ProductSearchIndex;
  embedders?: TextEmbedderSource | undefined;
  warn?: ((error: unknown) => void) | undefined;
  onIndexMissing?: (() => void) | undefined;
};

export type ProductRow = typeof products.$inferSelect;

export type ProductPage = {
  products: ProductRow[];
  hasMore: boolean;
};

const pageSize = (query: ProductSearchQuery): number => Math.min(Math.max(query.limit ?? 20, 1), MAX_LIMIT);

/** A page straight from PostgreSQL: ordered by SKU, matching names, SKUs and barcodes by substring. */
export const databaseProductPage = async (
  repository: Pick<DrizzleStoreRepository, "searchProducts">,
  query: ProductSearchQuery,
): Promise<ProductPage> => {
  const limit = pageSize(query);
  // One row more than the page, only to learn whether another page follows.
  const rows = await repository.searchProducts({ ...query, limit: limit + 1, offset: query.offset ?? 0 });
  return { products: rows.slice(0, limit), hasMore: rows.length > limit };
};

export const embedSearchQuery = async (
  embedders: TextEmbedderSource | undefined,
  search: string,
  warn?: (error: unknown) => void,
): Promise<ProductSearchRequest["semantic"]> => {
  if (!embedders || search.trim() === "") return undefined;
  const embedder = await embedders();
  if (!embedder) return undefined;
  try {
    return { embedding: await embedder.embedQuery(search), maxDistance: embedder.maxVectorDistance };
  } catch (error) {
    warn?.(error);
    return undefined;
  }
};

export const searchCatalogProducts = async (
  deps: ProductSearchDependencies,
  query: ProductSearchQuery,
): Promise<ProductPage> => {
  const { repository, index, embedders, warn, onIndexMissing } = deps;
  if (!query.search) return databaseProductPage(repository, query);
  try {
    const semantic =
      wordCount(query.search) >= SEMANTIC_MIN_WORDS ? await embedSearchQuery(embedders, query.search, warn) : undefined;
    const { ids, hasMore } = await index.search({
      text: query.search,
      semantic,
      category: query.category,
      prescriptionRequired: query.prescriptionRequired,
      limit: pageSize(query),
      offset: query.offset ?? 0,
    });
    return { products: await repository.listActiveProductsByIds(ids), hasMore };
  } catch (error) {
    if (error instanceof SearchIndexMissingError) onIndexMissing?.();
    warn?.(error);
    return databaseProductPage(repository, query);
  }
};
