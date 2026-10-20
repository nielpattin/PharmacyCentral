import { randomUUID } from "node:crypto";

import type { SearchSynonymGroup, SearchSynonymTerms } from "../../../../contracts/synonyms.ts";
import { foldSearchText } from "../search-text.ts";
import type { SynonymSetItem } from "../product-search-index.ts";
import type { SearchSynonymStore, SearchSynonymTransaction } from "./search-synonym-store.ts";

export type SearchSynonymErrorCode =
  | "search_synonym_not_found"
  | "version_conflict"
  | "self_review_forbidden"
  | "already_approved"
  | "invalid_request";

export class SearchSynonymError extends Error {
  public readonly code: SearchSynonymErrorCode;

  public constructor(code: SearchSynonymErrorCode) {
    super(code);
    this.code = code;
  }
}

export type SynonymServiceLogger = { warn(object: Record<string, unknown>, message: string): void };

export type SearchSynonymServiceOptions = {
  store: SearchSynonymStore;
  /** Pushes the approved set to the search index. Failures are logged and never reach the caller. */
  syncSynonyms: (items: SynonymSetItem[]) => Promise<void>;
  logger: SynonymServiceLogger;
  clock?: () => Date;
  newId?: () => string;
};

/** The approved groups as Typesense items, with terms folded the same way as indexed text and queries. */
export const toSynonymSetItems = (groups: SearchSynonymGroup[]): SynonymSetItem[] =>
  groups.map((group) => ({ id: group.id, synonyms: group.terms.map(foldSearchText) }));

/** Rejects two terms that fold to the same text, such as "Tiêu chảy" and "tieu chay". */
const distinctTerms = (terms: SearchSynonymTerms): SearchSynonymTerms => {
  const folded = new Set(terms.map(foldSearchText));
  if (folded.size !== terms.length) throw new SearchSynonymError("invalid_request");
  return terms;
};

const requireGroup = async (tx: SearchSynonymTransaction, id: string): Promise<SearchSynonymGroup> => {
  const group = await tx.findForUpdate(id);
  if (!group) throw new SearchSynonymError("search_synonym_not_found");
  return group;
};

const requireVersion = (group: SearchSynonymGroup, version: number): void => {
  if (group.version !== version) throw new SearchSynonymError("version_conflict");
};

/** Pending groups first, then approved ones. Within each part the newest submission comes first. */
const sortForReview = (groups: SearchSynonymGroup[]): SearchSynonymGroup[] =>
  [...groups].sort((left, right) => {
    if (left.status !== right.status) return left.status === "pending" ? -1 : 1;
    return Date.parse(right.submittedAt) - Date.parse(left.submittedAt);
  });

export class SearchSynonymService {
  private readonly store: SearchSynonymStore;
  private readonly syncSynonyms: (items: SynonymSetItem[]) => Promise<void>;
  private readonly logger: SynonymServiceLogger;
  private readonly clock: () => Date;
  private readonly newId: () => string;
  /** Pushes run one after another. Each push reads the database when it runs, so the last push carries the latest state. */
  private pushChain: Promise<void> = Promise.resolve();

  public constructor(options: SearchSynonymServiceOptions) {
    this.store = options.store;
    this.syncSynonyms = options.syncSynonyms;
    this.logger = options.logger;
    this.clock = options.clock ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  public async list(): Promise<SearchSynonymGroup[]> {
    return sortForReview(await this.store.list());
  }

  public async create(options: { actorId: string; terms: SearchSynonymTerms }): Promise<SearchSynonymGroup> {
    const terms = distinctTerms(options.terms);
    const submittedAt = this.clock().toISOString();
    return this.store.transaction((tx) => tx.insert({ terms, submittedBy: options.actorId, submittedAt }));
  }

  public async update(options: {
    actorId: string;
    id: string;
    terms: SearchSynonymTerms;
    version: number;
  }): Promise<SearchSynonymGroup> {
    const terms = distinctTerms(options.terms);
    const { next, wasApproved } = await this.store.transaction(async (tx) => {
      const current = await requireGroup(tx, options.id);
      requireVersion(current, options.version);
      const next: SearchSynonymGroup = {
        id: current.id,
        terms,
        version: current.version + 1,
        submittedBy: options.actorId,
        submittedAt: this.clock().toISOString(),
        status: "pending",
      };
      await tx.save(next);
      return { next, wasApproved: current.status === "approved" };
    });
    if (wasApproved) this.publishApprovedSet();
    return next;
  }

  public async approve(options: { actorId: string; id: string; version: number }): Promise<SearchSynonymGroup> {
    return this.store.transaction(async (tx) => {
      const current = await requireGroup(tx, options.id);
      if (current.status === "approved") throw new SearchSynonymError("already_approved");
      if (current.submittedBy === options.actorId) throw new SearchSynonymError("self_review_forbidden");
      requireVersion(current, options.version);
      const approved: SearchSynonymGroup = {
        id: current.id,
        terms: current.terms,
        version: current.version + 1,
        submittedBy: current.submittedBy,
        submittedAt: current.submittedAt,
        status: "approved",
        approvedBy: options.actorId,
        approvedAt: this.clock().toISOString(),
      };
      await tx.save(approved);
      this.publishApprovedSet();
      return approved;
    });
  }

  public async delete(options: { id: string }): Promise<void> {
    const wasApproved = await this.store.transaction(async (tx) => {
      const current = await requireGroup(tx, options.id);
      await tx.remove(current.id);
      return current.status === "approved";
    });
    if (wasApproved) this.publishApprovedSet();
  }

  /** The current approved set as Typesense items. Used by the index loader and by every push. */
  public async approvedSynonymItems(): Promise<SynonymSetItem[]> {
    return toSynonymSetItems(await this.store.listApproved());
  }

  /** Resolves once every queued push has finished. Callers that need the index state await this instead of a clock. */
  public pushesSettled(): Promise<void> {
    return this.pushChain;
  }

  private publishApprovedSet(): void {
    this.pushChain = this.pushChain
      .then(async () => this.syncSynonyms(await this.approvedSynonymItems()))
      .catch((error: unknown) => this.logger.warn({ error }, "search synonym push failed"));
  }
}
