import { and, eq, or, sql } from "drizzle-orm";

import type { IdentityDatabase } from "../../../shared/infrastructure/database.ts";
import { userRoles, userSiteScopes, users } from "../../../shared/infrastructure/schema.ts";
import type { Account, CustomerMatch } from "../domain/account.ts";

/** The customer fields a look-up may hand out; selecting them directly keeps the password hash out of the result. */
const customerColumns = {
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  phoneNumber: users.phoneNumber,
};

export class DrizzleAccountRepository {
  public constructor(private readonly database: IdentityDatabase) {}

  public async create(input: Omit<Account, "id" | "createdAt">): Promise<Account> {
    return this.database.db.transaction(async (transaction) => {
      const [user] = await transaction
        .insert(users)
        .values({
          actorType: input.actorType,
          isActive: input.isActive,
          email: input.email,
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          phoneNumber: input.phoneNumber ?? null,
          emailVerifiedAt: input.emailVerifiedAt ?? null,
        })
        .returning();
      if (!user) throw new Error("Account insert did not return a row");
      await this.replaceAccess(transaction, user.id, input.roles, input.siteIds);
      return { ...input, id: user.id, createdAt: user.createdAt };
    });
  }

  public async findByEmail(email: string): Promise<Account | undefined> {
    const user = (await this.database.db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    return user ? this.toAccount(user) : undefined;
  }

  public async findById(id: string): Promise<Account | undefined> {
    const user = (await this.database.db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    return user ? this.toAccount(user) : undefined;
  }

  /**
   * Counter staff search by the exact phone or email the patient gives them. The phone compares digit by digit, so
   * a number typed with spaces still finds the account, and only active customers are ever returned.
   */
  public async searchActiveCustomers(input: {
    email: string;
    phoneDigits: string;
    limit: number;
  }): Promise<CustomerMatch[]> {
    const email = sql`lower(${users.email}) = ${input.email}`;
    // The stored number is folded onto the same canonical form the service builds from the query: digits only, and a
    // country-code spelling written `84` plus nine digits rewritten as its `0` form.
    const phone = sql`regexp_replace(regexp_replace(coalesce(${users.phoneNumber}, ''), '[^0-9]', '', 'g'), '^84([0-9]{9})$', '0\\1') = ${input.phoneDigits}`;
    const matches = input.phoneDigits.length > 0 ? or(email, phone) : email;
    const rows = await this.database.db
      .select(customerColumns)
      .from(users)
      .where(and(eq(users.actorType, "customer"), eq(users.isActive, true), matches))
      .orderBy(users.email)
      .limit(input.limit);
    return rows.map((row) => ({ ...row, phoneNumber: row.phoneNumber ?? null }));
  }

  public async findActiveCustomerById(id: string): Promise<CustomerMatch | undefined> {
    const row = (
      await this.database.db
        .select(customerColumns)
        .from(users)
        .where(and(eq(users.id, id), eq(users.actorType, "customer"), eq(users.isActive, true)))
        .limit(1)
    )[0];
    return row ? { ...row, phoneNumber: row.phoneNumber ?? null } : undefined;
  }

  public async list(): Promise<Account[]> {
    const allUsers = await this.database.db.select().from(users).orderBy(users.email);
    return Promise.all(allUsers.map((user) => this.toAccount(user)));
  }

  public async save(account: Account): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({
          email: account.email,
          displayName: account.displayName,
          phoneNumber: account.phoneNumber ?? null,
          passwordHash: account.passwordHash,
          emailVerifiedAt: account.emailVerifiedAt ?? null,
          isActive: account.isActive,
          updatedAt: new Date(),
        })
        .where(eq(users.id, account.id));
      await this.replaceAccess(transaction, account.id, account.roles, account.siteIds);
    });
  }

  private async toAccount(user: typeof users.$inferSelect): Promise<Account> {
    if (!user.passwordHash) throw new Error("Account password hash is missing");
    const [roles, siteIds] = await Promise.all([
      this.database.db.select().from(userRoles).where(eq(userRoles.userId, user.id)),
      this.database.db.select().from(userSiteScopes).where(eq(userSiteScopes.userId, user.id)),
    ]);
    return {
      id: user.id,
      actorType: user.actorType as Account["actorType"],
      isActive: user.isActive,
      email: user.email,
      displayName: user.displayName,
      ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}),
      passwordHash: user.passwordHash,
      ...(user.emailVerifiedAt ? { emailVerifiedAt: user.emailVerifiedAt } : {}),
      roles: roles.map((role) => role.roleName),
      siteIds: siteIds.map((scope) => scope.siteId),
      createdAt: user.createdAt,
    };
  }

  private async replaceAccess(
    transaction: Parameters<Parameters<IdentityDatabase["db"]["transaction"]>[0]>[0],
    userId: string,
    roles: string[],
    siteIds: string[],
  ): Promise<void> {
    await transaction.delete(userRoles).where(eq(userRoles.userId, userId));
    await transaction.delete(userSiteScopes).where(eq(userSiteScopes.userId, userId));
    if (roles.length) await transaction.insert(userRoles).values(roles.map((roleName) => ({ userId, roleName })));
    if (siteIds.length) await transaction.insert(userSiteScopes).values(siteIds.map((siteId) => ({ userId, siteId })));
  }
}
