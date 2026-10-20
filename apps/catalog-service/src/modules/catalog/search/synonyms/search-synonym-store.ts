import type { SearchSynonymGroup, SearchSynonymTerms } from "../../../../contracts/synonyms.ts";

export type NewSearchSynonymGroup = {
  terms: SearchSynonymTerms;
  submittedBy: string;
  submittedAt: string;
};

/** Reads and writes inside one transaction. `findForUpdate` takes a row lock until the transaction ends. */
export interface SearchSynonymTransaction {
  findForUpdate(id: string): Promise<SearchSynonymGroup | undefined>;
  insert(group: NewSearchSynonymGroup): Promise<SearchSynonymGroup>;
  save(group: SearchSynonymGroup): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SearchSynonymStore {
  list(): Promise<SearchSynonymGroup[]>;
  listApproved(): Promise<SearchSynonymGroup[]>;
  transaction<T>(work: (tx: SearchSynonymTransaction) => Promise<T>): Promise<T>;
}
