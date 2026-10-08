import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IdentityDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { InMemorySessionRepository } from "../../sessions/infrastructure/in-memory-session-repository.ts";
import { AccountService } from "../application/account-service.ts";
import { VerificationTokenService } from "../application/verification-token-service.ts";
import { Argon2idPasswordHasher } from "../infrastructure/security/argon2id-password-hasher.ts";
import { DrizzleAccountRepository } from "./drizzle-account-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../../../drizzle/migrations", import.meta.url));

/**
 * The stored phone is folded onto the canonical form inside SQL, and the query is folded in TypeScript, so only a real
 * Postgres engine shows that both halves agree: a number kept with the `84` country code is found by its local
 * spelling and the other way round, while a colleague sharing the number never surfaces in the counter picker.
 */
describe("DrizzleAccountRepository customer lookup", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new DrizzleAccountRepository({ db, pool: undefined } as unknown as IdentityDatabase);
  const hasher = new Argon2idPasswordHasher({ memory: 19456, passes: 2, parallelism: 1, tagLength: 32 });
  const service = new AccountService(
    repository,
    new InMemorySessionRepository(),
    hasher,
    new VerificationTokenService(),
    { sendVerificationEmail: async () => undefined },
  );

  const countryCodeId = "00000000-0000-4000-8000-00000000000a";
  const localId = "00000000-0000-4000-8000-00000000000b";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await db.delete(schema.users);
    await db.insert(schema.users).values([
      {
        id: countryCodeId,
        actorType: "customer",
        email: "quoc-te@example.com",
        displayName: "Nguyễn Văn A",
        passwordHash: "hash",
        phoneNumber: "+84 901 234 567",
      },
      {
        id: localId,
        actorType: "customer",
        email: "noi-dia@example.com",
        displayName: "Trần Thị B",
        passwordHash: "hash",
        phoneNumber: "0901-234-567",
      },
      {
        id: "00000000-0000-4000-8000-00000000000c",
        actorType: "employee",
        email: "duocsi@example.com",
        displayName: "Dược sĩ",
        passwordHash: "hash",
        phoneNumber: "+84901234567",
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("matches the local and country-code spellings of one number and never an employee", async () => {
    const customer = (id: string, email: string, displayName: string, phoneNumber: string) => ({
      id,
      displayName,
      email,
      phoneNumber,
    });
    const customers = [
      customer(localId, "noi-dia@example.com", "Trần Thị B", "0901-234-567"),
      customer(countryCodeId, "quoc-te@example.com", "Nguyễn Văn A", "+84 901 234 567"),
    ];

    await expect(service.searchCustomers("0901234567")).resolves.toEqual(customers);
    await expect(service.searchCustomers("+84 901 234 567")).resolves.toEqual(customers);
  });

  it("keeps a deactivated customer out of both counter lookups", async () => {
    const deactivated = await repository.create({
      actorType: "customer",
      isActive: false,
      email: "nghi@example.com",
      displayName: "Lê Thị C",
      passwordHash: "hash",
      phoneNumber: "0909 876 543",
      roles: [],
      siteIds: [],
    });

    // The row is stored and read back with `is_active` false, yet neither counter lookup may hand it out.
    await expect(repository.findById(deactivated.id)).resolves.toMatchObject({ isActive: false });
    await expect(service.searchCustomers("nghi@example.com")).resolves.toEqual([]);
    await expect(service.searchCustomers("0909876543")).resolves.toEqual([]);
    await expect(service.findActiveCustomer(deactivated.id)).resolves.toBeUndefined();
    // The active customers of the fixture stay reachable, so the filter is about is_active and nothing else.
    await expect(service.findActiveCustomer(localId)).resolves.toEqual({ id: localId, displayName: "Trần Thị B" });
  });
});
