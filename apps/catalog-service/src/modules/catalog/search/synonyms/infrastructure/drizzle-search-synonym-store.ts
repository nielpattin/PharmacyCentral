import { eq } from "drizzle-orm";

import { searchSynonymTermsSchema, type SearchSynonymGroup } from "../../../../../contracts/synonyms.ts";
import type { CatalogDatabase } from "../../../../../shared/infrastructure/database.ts";
import { searchSynonymGroups } from "../../../../../shared/infrastructure/schema.ts";
import type { NewSearchSynonymGroup, SearchSynonymStore, SearchSynonymTransaction } from "../search-synonym-store.ts";

type Row = typeof searchSynonymGroups.$inferSelect;
type DatabaseTransaction = Parameters<Parameters<CatalogDatabase["db"]["transaction"]>[0]>[0];

const toGroup = (row: Row): SearchSynonymGroup => {
  const parsed = searchSynonymTermsSchema.safeParse(row.terms);
  if (!parsed.success) {
    throw new Error(`The search_synonym_groups row ${row.id} holds terms that fail validation.`);
  }
  const base = {
    id: row.id,
    terms: parsed.data,
    version: row.version,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt.toISOString(),
  };
  if (row.status === "pending" && row.approvedBy === null && row.approvedAt === null) {
    return { ...base, status: "pending" };
  }
  if (row.status === "approved" && row.approvedBy !== null && row.approvedAt !== null) {
    return { ...base, status: "approved", approvedBy: row.approvedBy, approvedAt: row.approvedAt.toISOString() };
  }
  throw new Error(`The search_synonym_groups row ${row.id} has an unknown status "${row.status}".`);
};

class DrizzleSearchSynonymTransaction implements SearchSynonymTransaction {
  private readonly tx: DatabaseTransaction;

  public constructor(tx: DatabaseTransaction) {
    this.tx = tx;
  }

  public async findForUpdate(id: string): Promise<SearchSynonymGroup | undefined> {
    const [row] = await this.tx
      .select()
      .from(searchSynonymGroups)
      .where(eq(searchSynonymGroups.id, id))
      .limit(1)
      .for("update");
    return row ? toGroup(row) : undefined;
  }

  public async insert(group: NewSearchSynonymGroup): Promise<SearchSynonymGroup> {
    const [row] = await this.tx
      .insert(searchSynonymGroups)
      .values({
        terms: group.terms,
        version: 1,
        status: "pending",
        submittedBy: group.submittedBy,
        submittedAt: new Date(group.submittedAt),
      })
      .returning();
    if (!row) throw new Error("The search_synonym_groups insert returned no row.");
    return toGroup(row);
  }

  public async save(group: SearchSynonymGroup): Promise<void> {
    await this.tx
      .update(searchSynonymGroups)
      .set({
        terms: group.terms,
        version: group.version,
        status: group.status,
        submittedBy: group.submittedBy,
        submittedAt: new Date(group.submittedAt),
        approvedBy: group.status === "approved" ? group.approvedBy : null,
        approvedAt: group.status === "approved" ? new Date(group.approvedAt) : null,
      })
      .where(eq(searchSynonymGroups.id, group.id));
  }

  public async remove(id: string): Promise<void> {
    await this.tx.delete(searchSynonymGroups).where(eq(searchSynonymGroups.id, id));
  }
}

export class DrizzleSearchSynonymStore implements SearchSynonymStore {
  private readonly database: CatalogDatabase;

  public constructor(database: CatalogDatabase) {
    this.database = database;
  }

  public async list(): Promise<SearchSynonymGroup[]> {
    const rows = await this.database.db.select().from(searchSynonymGroups);
    return rows.map(toGroup);
  }

  public async listApproved(): Promise<SearchSynonymGroup[]> {
    const rows = await this.database.db
      .select()
      .from(searchSynonymGroups)
      .where(eq(searchSynonymGroups.status, "approved"));
    return rows.map(toGroup);
  }

  public transaction<T>(work: (tx: SearchSynonymTransaction) => Promise<T>): Promise<T> {
    return this.database.db.transaction((tx) => work(new DrizzleSearchSynonymTransaction(tx)));
  }
}
