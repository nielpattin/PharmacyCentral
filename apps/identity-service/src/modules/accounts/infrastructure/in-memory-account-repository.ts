import { randomUUID } from "node:crypto";

import type { Account, CustomerMatch, StaffMember } from "../domain/account.ts";
import { canonicalPhoneDigits } from "../domain/phone-number.ts";

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

  public async searchActiveCustomers(input: {
    email: string;
    phoneDigits: string;
    limit: number;
  }): Promise<CustomerMatch[]> {
    return [...this.accounts.values()]
      .filter((account) => account.actorType === "customer" && account.isActive)
      .filter((account) => {
        if (account.email.toLowerCase() === input.email) return true;
        if (input.phoneDigits.length === 0) return false;
        return canonicalPhoneDigits(account.phoneNumber ?? "") === canonicalPhoneDigits(input.phoneDigits);
      })
      .sort((left, right) => left.email.localeCompare(right.email))
      .slice(0, input.limit)
      .map((account) => ({
        id: account.id,
        displayName: account.displayName,
        email: account.email,
        phoneNumber: account.phoneNumber ?? null,
      }));
  }

  public async findActiveCustomerById(id: string): Promise<CustomerMatch | undefined> {
    const account = this.accounts.get(id);
    if (!account || account.actorType !== "customer" || !account.isActive) return undefined;
    return {
      id: account.id,
      displayName: account.displayName,
      email: account.email,
      phoneNumber: account.phoneNumber ?? null,
    };
  }

  public async findActiveCustomersByIds(ids: string[]): Promise<CustomerMatch[]> {
    const matches: CustomerMatch[] = [];
    for (const id of ids) {
      const match = await this.findActiveCustomerById(id);
      if (match) matches.push(match);
    }
    return matches;
  }

  public async findActiveEmployeeById(id: string): Promise<StaffMember | undefined> {
    return (await this.listActiveEmployees()).find((member) => member.id === id);
  }

  /** The active employees by name. `sharingSiteIds` keeps those holding at least one of the sites; none shares none. */
  public async listActiveEmployees(sharingSiteIds?: readonly string[]): Promise<StaffMember[]> {
    if (sharingSiteIds !== undefined && sharingSiteIds.length === 0) return [];
    return [...this.accounts.values()]
      .filter((account) => account.actorType === "employee" && account.isActive)
      .filter(
        (account) => sharingSiteIds === undefined || account.siteIds.some((siteId) => sharingSiteIds.includes(siteId)),
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((account) => ({
        id: account.id,
        displayName: account.displayName,
        roles: [...account.roles],
        siteIds: [...account.siteIds],
      }));
  }
}
