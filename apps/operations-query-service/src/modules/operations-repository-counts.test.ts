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
const identity = () => "Bearer employee-token";
const siteA = "00000000-0000-4000-8000-00000000005a";

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/**
 * The dashboard reads each count from the service that owns the table, by the path it answers on. A count of `"fail"`
 * answers 500, the way a service that is down or unreachable does.
 */
describe("OperationsRepository counts come from the owning services", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new OperationsRepository({ db } as unknown as OperationsDatabase, {
    catalogUrl: "http://catalog.test",
    inventoryUrl: "http://inventory.test",
    salesUrl: "http://sales.test",
  });

  let counts: Record<string, number | "fail"> = {};
  let requests: Array<{ url: URL; scope: string | null }> = [];
  let ledger: Array<Record<string, unknown>> = [];

  const answer = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = new URL(String(input));
    requests.push({ url, scope: new Headers(init?.headers).get(scopeHeader) });
    if (url.pathname === "/inventory/movements/summary") return json(ledger);
    if (url.pathname.endsWith("/count")) {
      const value = counts[url.pathname];
      if (counts[url.pathname] === "fail") return new Response("boom", { status: 500 });
      return json({ count: value ?? 0 });
    }
    return json([]);
  };

  const requested = (pathname: string) => requests.filter((request) => request.url.pathname === pathname);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    // The projection counters span every site; they answer only when a network-wide reader cannot reach a service.
    await db.insert(schema.projectionCounters).values([
      { key: "inventory_pending_transfers", value: 5 },
      { key: "sales_open_prescriptions", value: 9 },
    ]);
  });

  beforeEach(() => {
    counts = {};
    requests = [];
    ledger = [];
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => answer(input, init));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await client.close();
  });

  it("answers the counts beyond any page, with the site scope and the open-state filters", async () => {
    counts = {
      "/products/count": 1234,
      "/inventory/transfers/count": 250,
      "/prescriptions/count": 310,
      "/inventory/stocktakes/count": 4,
      "/inventory/adjustments/count": 7,
      "/procurement/goods-receipts/count": 900,
    };

    await expect(repository.dashboard(identity, [siteA])).resolves.toMatchObject({
      totalProducts: 1234,
      pendingTransferCount: 250,
      openPrescriptionCount: 310,
      openStocktakeCount: 4,
      pendingAdjustmentCount: 7,
    });

    const [transfers] = requested("/inventory/transfers/count");
    expect(transfers?.url.searchParams.get("status")).toBe("PendingApproval,Draft,Approved,InTransit");
    expect(transfers?.scope).toBe(siteA);
    const [prescriptions] = requested("/prescriptions/count");
    expect(prescriptions?.url.searchParams.get("excludeStatus")).toBe("Dispensed,Cancelled");
    expect(prescriptions?.scope).toBe(siteA);
    const [stocktakes] = requested("/inventory/stocktakes/count");
    expect(stocktakes?.url.searchParams.get("excludeStatus")).toBe("Completed,Cancelled");
    const [adjustments] = requested("/inventory/adjustments/count");
    expect(adjustments?.url.searchParams.get("status")).toBe("Pending");
    const [receipts] = requested("/procurement/goods-receipts/count");
    expect(receipts?.scope).toBe(siteA);
    // The product count is not site-bound, so it is read without the scope header.
    expect(requested("/products/count")[0]?.scope).toBeNull();
  });

  it("keeps a reachable zero count and uses the projection counter only for an unreachable service", async () => {
    counts = { "/prescriptions/count": 0, "/inventory/transfers/count": "fail" };

    await expect(repository.dashboard(identity)).resolves.toMatchObject({
      openPrescriptionCount: 0,
      pendingTransferCount: 5,
    });
  });

  it("fails a scoped dashboard when a count endpoint does not answer, rather than report a fallback", async () => {
    counts = { "/inventory/transfers/count": "fail" };

    await expect(repository.dashboard(identity, [siteA])).rejects.toThrow(
      /Scoped read of \/inventory\/transfers\/count/,
    );
  });

  it("answers the receipt and dispense quantities from the all-time stock ledger", async () => {
    counts = { "/procurement/goods-receipts/count": 3 };
    ledger = [
      { movementType: "GoodsReceipt", count: 3, quantityIn: 40, quantityOut: 0 },
      { movementType: "Dispense", count: 5, quantityIn: 0, quantityOut: 12 },
    ];

    await expect(repository.financeSummary(identity, undefined, undefined, [siteA])).resolves.toMatchObject({
      receiptCount: 3,
      receiptQuantity: 40,
      dispensedQuantity: 12,
    });
    // The all-time ledger read carries no period, so it is not cut to the requested one.
    const allTime = requested("/inventory/movements/summary").find((request) => !request.url.searchParams.has("from"));
    expect(allTime?.scope).toBe(siteA);
  });
});
