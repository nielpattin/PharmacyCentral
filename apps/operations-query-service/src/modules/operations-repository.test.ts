import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OperationsDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { DASHBOARD_ACTIVITY_LIMIT, OperationsRepository } from "./operations-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));
const scopeHeader = "x-actor-site-ids";

const identity = () => "Bearer employee-token";
const siteA = "00000000-0000-4000-8000-00000000000a";
const siteB = "00000000-0000-4000-8000-00000000000b";
const batchA = "00000000-0000-4000-8000-00000000001a";
const batchB = "00000000-0000-4000-8000-00000000001b";
const batchElsewhere = "00000000-0000-4000-8000-00000000001c";
const locationA = "00000000-0000-4000-8000-00000000002a";
const locationB = "00000000-0000-4000-8000-00000000002b";

const staffOnlyCatalogPaths = ["/sites", "/storage-locations", "/suppliers"];

const dayFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The dashboard counts expiring batches, reading `/inventory/batches` — a list that answers every site — beside the
 * site-bound balances. Each test stands up the live services the way the real ones answer, filtering a site-bound
 * list by the site scope header, and only the real projection table shows that a scoped reader never falls back to
 * the network-wide counter.
 */
describe("OperationsRepository dashboard site scope", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new OperationsRepository({ db, pool: undefined } as unknown as OperationsDatabase, {
    catalogUrl: "http://catalog.test",
    inventoryUrl: "http://inventory.test",
    salesUrl: "http://sales.test",
  });

  const batches = [
    { id: batchA, expiryDate: dayFromNow(10) },
    { id: batchB, expiryDate: dayFromNow(10) },
    { id: batchElsewhere, expiryDate: dayFromNow(10) },
    { id: "00000000-0000-4000-8000-00000000001d", expiryDate: dayFromNow(300) },
  ];

  /** Every live list the dashboard loads; the site-bound ones answer by scope like the services behind them. */
  const stubLiveServices = (
    balances: Array<Record<string, unknown>>,
    catalogRows: Record<string, Array<Record<string, unknown>>> = {},
  ): void => {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const scope = new Headers(init?.headers).get(scopeHeader)?.split(",") ?? [];
      // The catalog lists these to a signed-in employee only; the service secret alone is answered 401.
      if (staffOnlyCatalogPaths.includes(url.pathname) && !new Headers(init?.headers).get("authorization")) {
        return new Response("{}", { status: 401 });
      }
      if (url.pathname.endsWith("/count")) {
        return new Response(JSON.stringify({ count: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const rows =
        url.pathname === "/inventory/balances"
          ? balances.filter((row) => scope.includes(String((row.balance as Record<string, unknown>).siteId ?? "")))
          : url.pathname === "/inventory/batches"
            ? batches
            : (catalogRows[url.pathname] ?? []);
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    });
  };

  const balance = (siteId: string, productBatchId?: string): Record<string, unknown> => ({
    balance: { siteId, ...(productBatchId ? { productBatchId } : {}) },
    ...(productBatchId ? { batch: { id: productBatchId } } : {}),
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    // The counter is network-wide; a scoped dashboard has to ignore it, so its value must never show up in one.
    await db.insert(schema.projectionCounters).values({ key: "inventory_expiring_batches", value: 99 });
  });

  // The live reads carry the shared internal secret, so the helper needs one in every test of this file.
  beforeEach(() => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await client.close();
  });

  it("keeps another site's expiring batch out of a scoped dashboard", async () => {
    stubLiveServices([balance(siteA, batchA), balance(siteB, batchB)]);

    await expect(repository.dashboard(identity, [siteA])).resolves.toMatchObject({ expiringBatchCount: 1 });
    await expect(repository.dashboard(identity)).resolves.toMatchObject({ expiringBatchCount: 3 });
  });

  it("counts no expiring batch when a scoped balance carries no batch reference", async () => {
    stubLiveServices([balance(siteA)]);

    await expect(repository.dashboard(identity, [siteA])).resolves.toMatchObject({ expiringBatchCount: 0 });
  });

  it("counts sites, storage locations and suppliers by reading the catalog as the employee who asked", async () => {
    const sentIdentity: string[] = [];
    stubLiveServices([], {
      "/sites": [
        { id: siteA, isActive: true },
        { id: siteB, isActive: false },
      ],
      "/storage-locations": [{ id: locationA, siteId: siteA, isActive: true }],
      "/suppliers": [{ id: "00000000-0000-4000-8000-0000000000a1" }, { id: "00000000-0000-4000-8000-0000000000a2" }],
    });
    const fetchStub = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const header = new Headers(init?.headers).get("authorization");
      if (header) sentIdentity.push(header);
      return fetchStub(input, init);
    });

    await expect(repository.dashboard(identity)).resolves.toMatchObject({
      totalSites: 2,
      activeSites: 1,
      totalStorageLocations: 1,
      totalSuppliers: 2,
    });
    expect(sentIdentity).toEqual(["Bearer employee-token", "Bearer employee-token", "Bearer employee-token"]);
  });

  it("answers a scoped dashboard from the catalog instead of failing on its storage locations", async () => {
    stubLiveServices([], { "/storage-locations": [{ id: locationA, siteId: siteA, isActive: true }] });

    await expect(repository.dashboard(identity, [siteA])).resolves.toMatchObject({ totalStorageLocations: 1 });
  });

  it("keeps another site's storage locations out of a scoped dashboard", async () => {
    // This catalog ignores the scope header, exactly like a service that would answer every location.
    stubLiveServices([], {
      "/sites": [
        { id: siteA, isActive: true },
        { id: siteB, isActive: true },
      ],
      "/storage-locations": [
        { id: locationA, siteId: siteA, isActive: true },
        { id: locationB, siteId: siteB, isActive: true },
      ],
    });

    await expect(repository.dashboard(identity, [siteA])).resolves.toMatchObject({
      totalStorageLocations: 1,
      activeStorageLocations: 1,
    });
    await expect(repository.dashboard(identity)).resolves.toMatchObject({
      totalStorageLocations: 2,
      activeStorageLocations: 2,
    });
  });

  it("fails a scoped dashboard when a site-bound list errors, and keeps the unscoped one lenient", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const scoped = new Headers(init?.headers).has(scopeHeader);
      // Balances are down. A scoped reader must not be told the pharmacy holds nothing, while the network-wide
      // dashboard is still worth answering without one list.
      if (scoped && url.pathname === "/inventory/balances") return new Response("boom", { status: 500 });
      const body = url.pathname.endsWith("/count") ? { count: 0 } : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(repository.dashboard(identity, [siteA])).rejects.toThrow(/Scoped read of \/inventory\/balances/);
    await expect(repository.dashboard(identity)).resolves.toBeDefined();
  });
});

/** The dashboard's recent activity: the caller's sites, the action families its roles may read, and a fixed size. */
describe("OperationsRepository dashboard recent activity", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new OperationsRepository({ db, pool: undefined } as unknown as OperationsDatabase, {
    catalogUrl: "http://catalog.test",
    inventoryUrl: "http://inventory.test",
    salesUrl: "http://sales.test",
  });
  const eventId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const warehouse = ["inventory", "procurement"] as const;

  const record = async (n: number, action: string, siteId: string | null, minutesAgo = n): Promise<void> => {
    await db.insert(schema.auditEvents).values({
      eventId: eventId(n),
      action,
      entityType: action.split(".")[1] ?? "unknown",
      siteId,
      payload: "{}",
      occurredAt: new Date(Date.now() - minutesAgo * 60_000),
    });
  };
  const actionsOf = (answer: { recentActivity: Array<{ action: string }> }): string[] =>
    answer.recentActivity.map((row) => row.action);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await record(1, "inventory.transfer.approved", siteA);
    await record(2, "sales.order.status-changed.v1", siteA);
    await record(3, "procurement.purchase-order.created", siteA);
    await record(4, "identity.auth.login", siteA);
    await record(5, "inventory.adjustment.created", siteB);
    await record(6, "catalog.product.updated", null);
  });

  beforeEach(() => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const body = new URL(input).pathname.endsWith("/count") ? { count: 0 } : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await client.close();
  });

  it("lists every action family when no family restriction is given", async () => {
    expect(actionsOf(await repository.dashboard(identity))).toStrictEqual([
      "inventory.transfer.approved",
      "sales.order.status-changed.v1",
      "procurement.purchase-order.created",
      "identity.auth.login",
      "inventory.adjustment.created",
      "catalog.product.updated",
    ]);
  });

  it("lists only inventory and procurement actions for the warehouse families", async () => {
    expect(actionsOf(await repository.dashboard(identity, undefined, { actionFamilies: warehouse }))).toStrictEqual([
      "inventory.transfer.approved",
      "procurement.purchase-order.created",
      "inventory.adjustment.created",
    ]);
  });

  it("keeps the site scope when it narrows by family too", async () => {
    expect(actionsOf(await repository.dashboard(identity, [siteA], { actionFamilies: warehouse }))).toStrictEqual([
      "inventory.transfer.approved",
      "procurement.purchase-order.created",
    ]);
    expect(actionsOf(await repository.dashboard(identity, [siteA]))).toStrictEqual([
      "inventory.transfer.approved",
      "sales.order.status-changed.v1",
      "procurement.purchase-order.created",
      "identity.auth.login",
    ]);
  });

  it("lists nothing for an empty family list", async () => {
    expect((await repository.dashboard(identity, undefined, { actionFamilies: [] })).recentActivity).toStrictEqual([]);
  });

  it("does not take a family for a prefix of another word", async () => {
    await record(7, "inventoryx.thing.created", siteA, 0);
    expect(actionsOf(await repository.dashboard(identity, undefined, { actionFamilies: warehouse }))).not.toContain(
      "inventoryx.thing.created",
    );
  });

  it("returns the newest rows up to the limit, with the actor, entity and site fields", async () => {
    for (let n = 100; n < 100 + DASHBOARD_ACTIVITY_LIMIT + 5; n += 1) {
      await record(n, "inventory.movement.recorded", siteA, 0);
    }
    const answer = await repository.dashboard(identity, [siteA], { actionFamilies: warehouse });
    expect(DASHBOARD_ACTIVITY_LIMIT).toBe(30);
    expect(answer.recentActivity).toHaveLength(30);
    expect(answer.recentActivity[0]).toMatchObject({ siteId: siteA, userId: null, entityId: null });
  });
});

/** The finance summary: what was paid and what was given back, from the payment events the projection keeps. */
describe("OperationsRepository finance summary", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new OperationsRepository({ db, pool: undefined } as unknown as OperationsDatabase, {
    catalogUrl: "http://catalog.test",
    inventoryUrl: "http://inventory.test",
    salesUrl: "http://sales.test",
  });
  const entry = (n: number, entryType: string, amount: string, occurredAt: string) => ({
    eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    entryType,
    amount,
    payload: "{}",
    occurredAt: new Date(occurredAt),
  });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    await db
      .insert(schema.financeEntries)
      .values([
        entry(1, "Payment", "100000.00", "2026-03-10T00:00:00Z"),
        entry(2, "Payment", "50000.00", "2026-03-20T00:00:00Z"),
        entry(3, "Refund", "30000.00", "2026-03-25T00:00:00Z"),
        entry(4, "Payment", "999.00", "2026-01-01T00:00:00Z"),
      ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("sums payments and refunds, and nets them", async () => {
    await expect(repository.financeSummary("2026-03-01T00:00:00Z", "2026-03-31T00:00:00Z")).resolves.toEqual({
      currency: "VND",
      paid: 150_000,
      refunded: 30_000,
      net: 120_000,
    });
  });

  it("covers every entry when no period is given", async () => {
    await expect(repository.financeSummary()).resolves.toMatchObject({ paid: 150_999, refunded: 30_000 });
  });
});
