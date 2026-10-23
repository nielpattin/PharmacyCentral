/** One Typesense synonym item. The terms are folded, because the index folds both text and queries. */
export type SynonymSetItem = { id: string; synonyms: string[] };

export type ProductSearchDocument = {
  id: string;
  sku: string;
  barcode?: string | undefined;
  nameFolded: string;
  genericNameFolded?: string | undefined;
  activeIngredientFolded?: string | undefined;
  indicationsFolded?: string | undefined;
  category?: string | undefined;
  prescriptionRequired: boolean;
  contentHash: string;
  /** `JSON.stringify({ ...productRow, units })`, the body `GET /products` returns for this product. */
  payload?: string | undefined;
  embedding?: number[] | undefined;
};

export type ProductSearchRequest = {
  text: string;
  /** The embedded query and the farthest vector-only hit worth keeping. Absent when no vector branch runs. */
  semantic?: { embedding: number[]; maxDistance: number } | undefined;
  category?: string | undefined;
  prescriptionRequired?: boolean | undefined;
  limit: number;
  offset: number;
};

export type ProductSearchResult = {
  /** At most `limit` ids, best first. */
  ids: string[];
  /** True when the index ranks results beyond this page. */
  hasMore: boolean;
};

export interface ProductSearchIndex {
  ensureReady(): Promise<void>;
  listContentHashes(): Promise<Map<string, string>>;
  upsert(documents: ProductSearchDocument[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  search(request: ProductSearchRequest): Promise<ProductSearchResult>;
}

export class SearchIndexMissingError extends Error {}
