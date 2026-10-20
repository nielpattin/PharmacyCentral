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
  embedding?: number[] | undefined;
};

export type ProductSearchRequest = {
  text: string;
  queryEmbedding?: number[] | undefined;
  category?: string | undefined;
  prescriptionRequired?: boolean | undefined;
  limit: number;
};

export interface ProductSearchIndex {
  ensureReady(): Promise<void>;
  listContentHashes(): Promise<Map<string, string>>;
  upsert(documents: ProductSearchDocument[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  search(request: ProductSearchRequest): Promise<string[]>;
}

export class SearchIndexMissingError extends Error {}
