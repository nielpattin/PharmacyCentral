import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OperationsDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { OperationsRepository } from "./operations-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));
const scopeHeader = "x-actor-site-ids";

const siteA = "00000000-0000-4000-8000-00000000000a";
const siteB = "00000000-0000-4000-8000-00000000000b";
const batchA = "00000000-0000-4000-8000-00000000001a";
const batchB = "00000000-0000-4000-8000-00000000001b";
const batchElsewhere = "00000000-0000-4000-8000-00000000001c";
const locationA = "00000000-0000-4000-8000-00000000002a";
const locationB = "00000000-0000-4000-8000-00000000002b";

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

    await expect(repository.dashboard([siteA])).resolves.toMatchObject({ expiringBatchCount: 1 });
    await expect(repository.dashboard()).resolves.toMatchObject({ expiringBatchCount: 3 });
  });

  it("counts no expiring batch when a scoped balance carries no batch reference", async () => {
    stubLiveServices([balance(siteA)]);

    await expect(repository.dashboard([siteA])).resolves.toMatchObject({ expiringBatchCount: 0 });
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

    await expect(repository.dashboard([siteA])).resolves.toMatchObject({
      totalStorageLocations: 1,
      activeStorageLocations: 1,
    });
    await expect(repository.dashboard()).resolves.toMatchObject({
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

    await expect(repository.dashboard([siteA])).rejects.toThrow(/Scoped read of \/inventory\/balances/);
    await expect(repository.dashboard()).resolves.toBeDefined();
  });

  it("values stock at the base-unit published price and lists a product without one as missing a price", async () => {
    const priced = "00000000-0000-4000-8000-00000000003a";
    const unpriced = "00000000-0000-4000-8000-00000000003b";
    const stocked = (siteId: string, productId: string, quantityOnHand: string, quantityReserved = "0") => ({
      balance: { siteId, quantityOnHand, quantityReserved },
      batch: { id: batchA, productId, batchNumber: `LOT-${productId.slice(-2)}` },
    });
    stubLiveServices(
      [
        stocked(siteA, priced, "30.000000", "10.000000"),
        stocked(siteA, unpriced, "5.000000"),
        stocked(siteA, priced, "0.000000"),
        // Another pharmacy's stock must never be valued for a reader scoped to site A.
        stocked(siteB, priced, "1000.000000"),
      ],
      {
        "/sites": [{ id: siteA, name: "Pharmacy A" }],
        // The catalog answers today's base-unit price per product (null when none qualifies).
        "/pricing/base-prices": [
          { productId: priced, productName: "Paracetamol 500mg", unitPrice: 5_000 },
          { productId: unpriced, productName: "Vitamin C", unitPrice: null },
        ],
        "/inventory/movements/summary": [
          { movementType: "TransferOut", count: 1, quantityIn: 0, quantityOut: 4 },
          { movementType: "TransferIn", count: 1, quantityIn: 2, quantityOut: 0 },
          { movementType: "InventoryReturn", count: 1, quantityIn: 0, quantityOut: 1 },
          { movementType: "StockAdjustment", count: 2, quantityIn: 1, quantityOut: 3 },
          { movementType: "StocktakeAdjustment", count: 1, quantityIn: 5, quantityOut: 0 },
        ],
      },
    );

    const summary = await repository.financeSummary(undefined, undefined, [siteA]);

    expect(summary).toMatchObject({
      inventoryValue: 150_000,
      reservedValue: 50_000,
      missingPriceCount: 1,
      returnQuantity: 1,
      adjustmentQuantity: 3,
      transferOutQuantity: 4,
      transferInQuantity: 2,
    });
    expect(summary.valuationLines).toEqual([
      expect.objectContaining({
        productName: "Paracetamol 500mg",
        siteName: "Pharmacy A",
        quantityOnHand: 30,
        unitPrice: 5_000,
        valueOnHand: 150_000,
        priceStatus: "Priced",
      }),
      expect.objectContaining({ productName: "Vitamin C", valueOnHand: null, priceStatus: "Missing price" }),
    ]);
  });
});
