import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IdentityDatabase, IdentityExecutor } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { AccountService } from "../application/account-service.ts";
import { VerificationTokenService } from "../application/verification-token-service.ts";
import { Argon2idPasswordHasher } from "../infrastructure/security/argon2id-password-hasher.ts";
import { DrizzleAccountRepository } from "./drizzle-account-repository.ts";
import { createDrizzleUnitOfWork } from "./unit-of-work.ts";
import { DrizzleSessionRepository } from "../../sessions/infrastructure/drizzle-session-repository.ts";
import { AccountError } from "../domain/account-error.ts";

const migrationsFolder = fileURLToPath(new URL("../../../../drizzle/migrations", import.meta.url));

/**
 * The stored phone is folded onto the canonical form inside SQL, and the query is folded in TypeScript, so only a real
 * Postgres engine shows that both halves agree: a number kept with the `84` country code is found by its local
 * spelling and the other way round, while a colleague sharing the number never surfaces in the counter picker.
 */
describe("DrizzleAccountRepository", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  // PGlite and node-postgres Drizzle instances share one query API but differ in their result types, so the test
  // narrows the PGlite instance to the production executor type. The migrations and assertions still run on PGlite.
  const executor = db as unknown as IdentityExecutor;
  // The unit of work only reads `db`; the pool is not used against PGlite, so it is absent here.
  const identityDatabase = { db, pool: undefined } as unknown as IdentityDatabase;
  const repository = new DrizzleAccountRepository(executor);
  const sessions = new DrizzleSessionRepository(executor);
  const hasher = new Argon2idPasswordHasher({ memory: 19456, passes: 2, parallelism: 1, tagLength: 32 });
  const service = new AccountService(
    repository,
    sessions,
    hasher,
    new VerificationTokenService(),
    { sendVerificationEmail: async () => undefined },
    createDrizzleUnitOfWork(identityDatabase),
  );

  const countryCodeId = "00000000-0000-4000-8000-00000000000a";
  const localId = "00000000-0000-4000-8000-00000000000b";
  const employeeId = "00000000-0000-4000-8000-00000000000c";
  const adminId = "00000000-0000-4000-8000-0000000000a1";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await db.delete(schema.sessions);
    await db.delete(schema.outboxMessages);
    await db.delete(schema.userSiteScopes);
    await db.delete(schema.userRoles);
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
        id: employeeId,
        actorType: "employee",
        email: "duocsi@example.com",
        displayName: "Dược sĩ",
        passwordHash: "hash",
        phoneNumber: "+84901234567",
      },
      {
        id: adminId,
        actorType: "employee",
        email: "quan-tri@example.com",
        displayName: "Quản trị",
        passwordHash: "hash",
      },
    ]);
    await db.insert(schema.userRoles).values([
      { userId: employeeId, roleName: "Pharmacist" },
      { userId: adminId, roleName: "Platform Admin" },
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
      mustChangePassword: false,
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
    await expect(service.findActiveCustomer(localId)).resolves.toEqual({
      id: localId,
      displayName: "Trần Thị B",
      phoneNumber: "0901-234-567",
    });
    await expect(service.findActiveCustomers([localId, employeeId, deactivated.id])).resolves.toEqual([
      { id: localId, displayName: "Trần Thị B", phoneNumber: "0901-234-567" },
    ]);
  });

  it("deactivates an employee, ends the session and writes the audit entry in one transaction", async () => {
    const session = await sessions.create(employeeId, new Date(Date.now() + 60_000));

    await service.deactivateEmployee(adminId, employeeId);

    await expect(repository.findById(employeeId)).resolves.toMatchObject({ isActive: false });
    await expect(sessions.findActive(session.rawToken)).resolves.toBeUndefined();
    const audit = await db.select().from(schema.outboxMessages);
    expect(audit.map((row) => row.eventType)).toEqual(["identity.audit.v1"]);
    expect(JSON.parse(audit[0]?.payload ?? "{}")).toMatchObject({
      action: "identity.user.deactivated",
      entityId: employeeId,
      actorId: adminId,
    });
  });

  it("rolls the deactivation back when its audit entry cannot be written", async () => {
    const session = await sessions.create(employeeId, new Date(Date.now() + 60_000));

    // Park the outbox table so the audit insert inside the same transaction fails.
    await client.exec('ALTER TABLE "outbox_messages" RENAME TO "outbox_messages_parked"');
    try {
      const refusal: unknown = await service.deactivateEmployee(adminId, employeeId).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      if (!(refusal instanceof AccountError)) throw new Error("Expected the deactivation to be refused");
      expect(refusal.code).toBe("audit_unavailable");
    } finally {
      await client.exec('ALTER TABLE "outbox_messages_parked" RENAME TO "outbox_messages"');
    }

    await expect(repository.findById(employeeId)).resolves.toMatchObject({ isActive: true });
    await expect(sessions.findActive(session.rawToken)).resolves.toMatchObject({ accountId: employeeId });
  });

  it("lists active employees by name with their roles and sites, narrowed by site, and never a customer", async () => {
    const siteA = "00000000-0000-4000-8000-0000000000e1";
    const siteB = "00000000-0000-4000-8000-0000000000e2";
    const unknownSite = "00000000-0000-4000-8000-0000000000e9";
    await db.insert(schema.userSiteScopes).values([
      { userId: employeeId, siteId: siteA },
      { userId: employeeId, siteId: siteB },
    ]);
    const deactivated = await repository.create({
      actorType: "employee",
      isActive: false,
      mustChangePassword: false,
      email: "nghi-viec@example.com",
      displayName: "Nghỉ việc",
      passwordHash: "hash",
      roles: ["Pharmacist"],
      siteIds: [siteA],
    });

    const everyone = await repository.listActiveEmployees();
    expect(everyone.map((member) => member.id)).toEqual([employeeId, adminId]);
    expect(everyone[0]?.roles).toEqual(["Pharmacist"]);
    expect([...(everyone[0]?.siteIds ?? [])].sort()).toEqual([siteA, siteB]);
    expect(everyone[1]).toEqual({ id: adminId, displayName: "Quản trị", roles: ["Platform Admin"], siteIds: [] });
    // The directory answer carries no contact field: the employee's email never reaches it.
    expect(JSON.stringify(everyone)).not.toContain("duocsi@example.com");

    // An employee is listed for any one of their sites; a deactivated colleague at the same site never is.
    expect((await repository.listActiveEmployees([siteB])).map((member) => member.id)).toEqual([employeeId]);
    expect((await repository.listActiveEmployees([siteA])).map((member) => member.id)).toEqual([employeeId]);
    expect(await repository.listActiveEmployees([unknownSite])).toEqual([]);
    expect(await repository.listActiveEmployees([])).toEqual([]);
    expect((await repository.listActiveEmployees([siteA])).map((member) => member.id)).not.toContain(deactivated.id);

    await expect(repository.findActiveEmployeeById(employeeId)).resolves.toMatchObject({ id: employeeId });
    await expect(repository.findActiveEmployeeById(countryCodeId)).resolves.toBeUndefined();
    await expect(repository.findActiveEmployeeById(deactivated.id)).resolves.toBeUndefined();
  });
});
