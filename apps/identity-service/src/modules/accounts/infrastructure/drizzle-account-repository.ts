import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import type { IdentityExecutor } from "../../../shared/infrastructure/database.ts";
import { userRoles, userSiteScopes, users } from "../../../shared/infrastructure/schema.ts";
import type { Account, CustomerMatch, StaffMember } from "../domain/account.ts";

/** The customer fields a look-up may hand out; selecting them directly keeps the password hash out of the result. */
const customerColumns = {
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  phoneNumber: users.phoneNumber,
};

/**
 * Runs on the pool or inside a transaction, so a unit of work can make several writes that commit or fail together.
 */
export class DrizzleAccountRepository {
  public constructor(private readonly executor: IdentityExecutor) {}

  public async create(input: Omit<Account, "id" | "createdAt">): Promise<Account> {
    return this.executor.transaction(async (transaction) => {
      const [user] = await transaction
        .insert(users)
        .values({
          actorType: input.actorType,
          isActive: input.isActive,
          mustChangePassword: input.mustChangePassword,
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
    const user = (await this.executor.select().from(users).where(eq(users.email, email)).limit(1))[0];
    return user ? this.toAccount(user) : undefined;
  }

  public async findById(id: string): Promise<Account | undefined> {
    const user = (await this.executor.select().from(users).where(eq(users.id, id)).limit(1))[0];
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
    const rows = await this.executor
      .select(customerColumns)
      .from(users)
      .where(and(eq(users.actorType, "customer"), eq(users.isActive, true), matches))
      .orderBy(users.email)
      .limit(input.limit);
    return rows.map((row) => ({ ...row, phoneNumber: row.phoneNumber ?? null }));
  }

  public async findActiveCustomerById(id: string): Promise<CustomerMatch | undefined> {
    const row = (
      await this.executor
        .select(customerColumns)
        .from(users)
        .where(and(eq(users.id, id), eq(users.actorType, "customer"), eq(users.isActive, true)))
        .limit(1)
    )[0];
    return row ? { ...row, phoneNumber: row.phoneNumber ?? null } : undefined;
  }

  public async findActiveCustomersByIds(ids: string[]): Promise<CustomerMatch[]> {
    if (ids.length === 0) return [];
    const rows = await this.executor
      .select(customerColumns)
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.actorType, "customer"), eq(users.isActive, true)));
    return rows.map((row) => ({ ...row, phoneNumber: row.phoneNumber ?? null }));
  }

  public async findActiveEmployeeById(id: string): Promise<StaffMember | undefined> {
    return (await this.activeEmployees(eq(users.id, id)))[0];
  }

  /**
   * The active employees by name, with their roles and sites. `sharingSiteIds` keeps those holding at least one of the
   * sites; left out, every active employee is returned. An empty list shares no site, so it returns nobody.
   */
  public async listActiveEmployees(sharingSiteIds?: readonly string[]): Promise<StaffMember[]> {
    if (sharingSiteIds !== undefined && sharingSiteIds.length === 0) return [];
    const sharesSite =
      sharingSiteIds === undefined
        ? undefined
        : inArray(
            users.id,
            this.executor
              .select({ userId: userSiteScopes.userId })
              .from(userSiteScopes)
              .where(inArray(userSiteScopes.siteId, [...sharingSiteIds])),
          );
    return this.activeEmployees(sharesSite);
  }

  public async list(): Promise<Account[]> {
    const allUsers = await this.executor.select().from(users).orderBy(users.email);
    return Promise.all(allUsers.map((user) => this.toAccount(user)));
  }

  public async save(account: Account): Promise<void> {
    await this.executor.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({
          email: account.email,
          displayName: account.displayName,
          phoneNumber: account.phoneNumber ?? null,
          passwordHash: account.passwordHash,
          emailVerifiedAt: account.emailVerifiedAt ?? null,
          isActive: account.isActive,
          mustChangePassword: account.mustChangePassword,
          updatedAt: new Date(),
        })
        .where(eq(users.id, account.id));
      await this.replaceAccess(transaction, account.id, account.roles, account.siteIds);
    });
  }

  private async toAccount(user: typeof users.$inferSelect): Promise<Account> {
    if (!user.passwordHash) throw new Error("Account password hash is missing");
    const [roles, siteIds] = await Promise.all([
      this.executor.select().from(userRoles).where(eq(userRoles.userId, user.id)),
      this.executor.select().from(userSiteScopes).where(eq(userSiteScopes.userId, user.id)),
    ]);
    return {
      id: user.id,
      actorType: user.actorType as Account["actorType"],
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
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

  /** Active employees by name, each with its roles and sites. `condition` narrows the users read. */
  private async activeEmployees(condition: SQL | undefined): Promise<StaffMember[]> {
    const rows = await this.executor
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.actorType, "employee"), eq(users.isActive, true), condition))
      .orderBy(users.displayName, users.id);
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [roles, siteScopes] = await Promise.all([
      this.executor.select().from(userRoles).where(inArray(userRoles.userId, ids)),
      this.executor.select().from(userSiteScopes).where(inArray(userSiteScopes.userId, ids)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      roles: roles.filter((role) => role.userId === row.id).map((role) => role.roleName),
      siteIds: siteScopes.filter((scope) => scope.userId === row.id).map((scope) => scope.siteId),
    }));
  }

  private async replaceAccess(
    transaction: IdentityExecutor,
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
