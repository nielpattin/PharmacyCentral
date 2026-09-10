import { randomUUID } from "node:crypto";

import type { Account } from "../domain/account.ts";

export class InMemoryAccountRepository {
  private readonly accounts = new Map<string, Account>();

  public async create(account: Omit<Account, "id" | "createdAt">): Promise<Account> {
    const created: Account = { ...account, id: randomUUID(), createdAt: new Date() };
    this.accounts.set(created.id, created);
    return created;
  }

  public async findByEmail(email: string): Promise<Account | undefined> {
    return [...this.accounts.values()].find((account) => account.email === email);
  }

  public async findById(id: string): Promise<Account | undefined> {
    return this.accounts.get(id);
  }

  public async list(): Promise<Account[]> {
    return [...this.accounts.values()].map((account) => ({
      ...account,
      roles: [...account.roles],
      siteIds: [...account.siteIds],
    }));
  }

  public async save(account: Account): Promise<void> {
    this.accounts.set(account.id, account);
  }
}
