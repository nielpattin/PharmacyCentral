import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import type { Page } from "./keyset-page.ts";
import { everything, readPageRequest, type PageOptions, type PageRequest } from "./page-cursor.ts";
import { ProcurementRepository } from "./procurement-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

/**
 * Purchase orders and goods receipts list newest first and page by keyset, and their search and counts answer the
 * same rows as the list. Only the real engine with the real migrations shows the ordering and the cursor comparison.
 */
describe("ProcurementRepository paging", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new ProcurementRepository({ db, pool: undefined } as unknown as InventoryDatabase);

  const site = "00000000-0000-4000-8000-00000000000a";
  const otherSite = "00000000-0000-4000-8000-00000000000b";
  const location = "00000000-0000-4000-8000-00000000001a";
  const supplier = "00000000-0000-4000-8000-00000000002a";
  const actor = "00000000-0000-4000-8000-00000000003a";
  const sameInstant = new Date("2026-03-01T10:00:00Z");
  const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const timestampPage: PageOptions = { kind: "timestamp", defaultLimit: 100, maxLimit: 500 };

  /** Follows the cursors the way a client does, each one read back by the route's own parser. */
  const everyPage = async <Row>(limit: number, list: (page: PageRequest) => Promise<Page<Row>>): Promise<Row[][]> => {
    const pages: Row[][] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const query = cursor === undefined ? { limit: String(limit) } : { limit: String(limit), cursor };
      const page = readPageRequest(query, timestampPage);
      if (!page) throw new Error("the repository's own cursor was refused");
      const answer = await list(page);
      pages.push(answer.rows);
      if (answer.nextCursor === undefined) return pages;
      cursor = answer.nextCursor;
    }
    throw new Error("paging did not end");
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec(`TRUNCATE purchase_orders, purchase_order_lines, goods_receipts, goods_receipt_lines CASCADE;`);
    // Four orders: three share one timestamp, and PO-2026-004 is the newest and sits at the other site.
    const order = (n: number, status: string, siteId: string, createdAt: Date) => ({
      id: idOf(0x100 + n),
      purchaseOrderNumber: `PO-2026-00${n}`,
      supplierId: supplier,
      siteId,
      status,
      createdBy: actor,
      createdAt,
    });
    await db
      .insert(schema.purchaseOrders)
      .values([
        order(1, "Approved", site, sameInstant),
        order(2, "Draft", site, sameInstant),
        order(3, "Approved", site, sameInstant),
        order(4, "Draft", otherSite, new Date("2026-03-02T10:00:00Z")),
      ]);
    // Three receipts, with the newest received last and at the other site.
    const receipt = (n: number, siteId: string, receivedAt: Date) => ({
      id: idOf(0x200 + n),
      receiptNumber: `GR-2026-00${n}`,
      supplierId: supplier,
      siteId,
      storageLocationId: location,
      receivedAt,
      createdBy: actor,
    });
    await db
      .insert(schema.goodsReceipts)
      .values([
        receipt(1, site, new Date("2026-02-01T10:00:00Z")),
        receipt(2, site, new Date("2026-02-15T10:00:00Z")),
        receipt(3, otherSite, new Date("2026-03-01T10:00:00Z")),
      ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("lists purchase orders newest first and pages them without repeats or gaps", async () => {
    const pages = await everyPage(2, (page) => repository.listPurchaseOrders({ siteIds: [site] }, page));

    expect(pages.map((rows) => rows.length)).toEqual([2, 1]);
    // Orders 1 to 3 share an instant, so they follow in descending id order; order 4 is at the other site.
    expect(pages.flat().map((order) => order.purchaseOrderNumber)).toEqual([
      "PO-2026-003",
      "PO-2026-002",
      "PO-2026-001",
    ]);
  });

  it("keeps the status and the number search on every page", async () => {
    const approved = await everyPage(1, (page) =>
      repository.listPurchaseOrders({ siteIds: [site], status: "Approved" }, page),
    );
    const searched = await repository.listPurchaseOrders({ siteIds: [site], q: "2026-00" }, everything);

    expect(approved.flat().map((order) => order.status)).toEqual(["Approved", "Approved"]);
    expect(approved.map((rows) => rows.length)).toEqual([1, 1]);
    expect(searched.rows).toHaveLength(3);
    expect(searched.nextCursor).toBeUndefined();
  });

  it("counts the purchase orders its list selects", async () => {
    await expect(repository.countPurchaseOrders({ siteIds: [site] })).resolves.toBe(3);
    await expect(repository.countPurchaseOrders({ siteIds: [site], status: "Draft" })).resolves.toBe(1);
    await expect(repository.countPurchaseOrders({ siteIds: [otherSite] })).resolves.toBe(1);
    await expect(repository.countPurchaseOrders({ siteIds: [] })).resolves.toBe(0);
  });

  it("lists goods receipts newest first by receipt date and pages them", async () => {
    const pages = await everyPage(1, (page) => repository.listReceipts({ siteIds: [site] }, page));

    expect(pages.flat().map((receipt) => receipt.receiptNumber)).toEqual(["GR-2026-002", "GR-2026-001"]);
    expect(pages.map((rows) => rows.length)).toEqual([1, 1]);
  });

  it("searches goods receipts by number and counts them by site", async () => {
    const searched = await repository.listReceipts({ siteIds: [site, otherSite], q: "gr-2026-00" }, everything);

    expect(searched.rows.map((receipt) => receipt.receiptNumber)).toEqual([
      "GR-2026-003",
      "GR-2026-002",
      "GR-2026-001",
    ]);
    await expect(repository.countReceipts({ siteIds: [site] })).resolves.toBe(2);
    await expect(repository.countReceipts({ siteIds: [site], q: "003" })).resolves.toBe(0);
    await expect(repository.countReceipts({ siteIds: [otherSite], q: "003" })).resolves.toBe(1);
  });
});
