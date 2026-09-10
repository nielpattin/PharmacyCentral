import { eq } from "drizzle-orm";

import type { IdentityDatabase } from "../../../shared/infrastructure/database.ts";
import { userRoles, userSiteScopes, users } from "../../../shared/infrastructure/schema.ts";
import type { Account } from "../domain/account.ts";

export class DrizzleAccountRepository {
  public constructor(private readonly database: IdentityDatabase) {}

  public async create(input: Omit<Account, "id" | "createdAt">): Promise<Account> {
    return this.database.db.transaction(async (transaction) => {
      const [user] = await transaction
        .insert(users)
        .values({
          actorType: input.actorType,
          email: input.email,
          displayName: input.displayName,
          passwordHash: input.passwordHash,
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
          passwordHash: account.passwordHash,
          emailVerifiedAt: account.emailVerifiedAt ?? null,
          isActive: true,
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
      email: user.email,
      displayName: user.displayName,
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
