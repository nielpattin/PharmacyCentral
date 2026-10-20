import type { products } from "../../../shared/infrastructure/schema.ts";
import type { DrizzleStoreRepository } from "../../stores/infrastructure/drizzle-store-repository.ts";

import { SearchIndexMissingError, type ProductSearchIndex } from "./product-search-index.ts";
import type { TextEmbedderSource } from "./text-embedder.ts";

/**
 * Weight of the vector branch in Typesense hybrid rank fusion. Typesense defaults to 0.3.
 */
export const SEMANTIC_ALPHA = 0.3;
/**
 * Cosine distance above which a vector-only hit is dropped (0 to 2). Keyword matches are always kept. On the seeded
 * catalog, relevant vector-only hits measured 0.30 to 0.32 and unrelated ones 0.35 and up.
 */
export const SEMANTIC_MAX_DISTANCE = 0.35;

const MAX_LIMIT = 100;

export type ProductSearchQuery = {
  search?: string | undefined;
  limit?: number | undefined;
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

export const embedSearchQuery = async (
  embedders: TextEmbedderSource | undefined,
  search: string,
  warn?: (error: unknown) => void,
): Promise<number[] | undefined> => {
  if (!embedders || search.trim() === "") return undefined;
  const embedder = await embedders();
  if (!embedder) return undefined;
  try {
    return await embedder.embedQuery(search);
  } catch (error) {
    warn?.(error);
    return undefined;
  }
};

export const searchCatalogProducts = async (
  deps: ProductSearchDependencies,
  query: ProductSearchQuery,
): Promise<ProductRow[]> => {
  const { repository, index, embedders, warn, onIndexMissing } = deps;
  if (!query.search) return repository.searchProducts(query);
  try {
    const queryEmbedding = await embedSearchQuery(embedders, query.search, warn);
    const ids = await index.search({
      text: query.search,
      queryEmbedding,
      category: query.category,
      prescriptionRequired: query.prescriptionRequired,
      limit: Math.min(Math.max(query.limit ?? 20, 1), MAX_LIMIT),
    });
    return await repository.listActiveProductsByIds(ids);
  } catch (error) {
    if (error instanceof SearchIndexMissingError) onIndexMissing?.();
    warn?.(error);
    return repository.searchProducts(query);
  }
};
