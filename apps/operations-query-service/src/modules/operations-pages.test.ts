import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OperationsDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { decodePageCursor, encodePageCursor, type PageCursor } from "./page-cursor.ts";
import { OperationsRepository } from "./operations-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

const siteA = "00000000-0000-4000-8000-00000000005a";
const siteB = "00000000-0000-4000-8000-00000000005b";
const order1 = "00000000-0000-4000-8000-0000000000a1";
const order2 = "00000000-0000-4000-8000-0000000000a2";
const rx1 = "00000000-0000-4000-8000-0000000000b1";

const eventId = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const cursorOf = (next: PageCursor | undefined): PageCursor => {
  if (!next) throw new Error("expected a next page");
  const decoded = decodePageCursor(encodePageCursor(next));
  if (!decoded) throw new Error("cursor did not round-trip");
  return decoded;
};

/**
 * Audit events 1-3 share one occurredAt and event 4 is a microsecond later, so the event id breaks the tie. Newest
 * first is 4, 3, 2, 1, 5. Only events 2, 1 and 5 belong to site A; event 3 names no site at all.
 */
const audits = [
  {
    n: 1,
    action: "sales.order.created.v1",
    entityType: "order",
    entityId: order1,
    siteId: siteA,
    at: "2026-10-24T10:00:00.000000Z",
  },
  {
    n: 2,
    action: "sales.prescription.created.v1",
    entityType: "prescription",
    entityId: rx1,
    siteId: siteA,
    at: "2026-10-24T10:00:00.000000Z",
  },
  {
    n: 3,
    action: "sales.order.status-changed.v1",
    entityType: "order",
    entityId: order1,
    siteId: null,
    at: "2026-10-24T10:00:00.000000Z",
  },
  {
    n: 4,
    action: "sales.prescription.dispensed.v1",
    entityType: "prescription",
    entityId: rx1,
    siteId: siteB,
    at: "2026-10-24T10:00:00.000001Z",
  },
  {
    n: 5,
    action: "sales.order.created.v1",
    entityType: "order",
    entityId: order2,
    siteId: siteA,
    at: "2026-10-24T09:00:00.000000Z",
  },
];

/** Report rows 1-3 share one occurredAt; row 4 is an hour later. Newest first is 4, 3, 2, 1. */
const reports = [
  { n: 1, reportType: "payment.invoice.paid.v1", at: "2026-10-24T10:00:00.000000Z" },
  { n: 2, reportType: "payment.invoice.paid.v1", at: "2026-10-24T10:00:00.000000Z" },
  { n: 3, reportType: "payment.invoice.refunded.v1", at: "2026-10-24T10:00:00.000000Z" },
  { n: 4, reportType: "payment.invoice.paid.v1", at: "2026-10-24T11:00:00.000000Z" },
];

describe("OperationsRepository audit and report pages", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new OperationsRepository({ db } as unknown as OperationsDatabase);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
    for (const audit of audits) {
      await db.insert(schema.auditEvents).values({
        eventId: eventId(audit.n),
        actorId: null,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId,
        siteId: audit.siteId,
        payload: "{}",
        occurredAt: sql`${audit.at}::timestamptz`,
      });
    }
    for (const report of reports) {
      await db.insert(schema.reportRows).values({
        id: eventId(report.n),
        eventId: eventId(100 + report.n),
        reportType: report.reportType,
        subjectId: null,
        value: "1",
        payload: "{}",
        occurredAt: sql`${report.at}::timestamptz`,
      });
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it("answers the first audit page newest first, with a next cursor only while rows remain", async () => {
    const first = await repository.listAudit({ limit: 2 });
    expect(first.rows.map((row) => row.eventId)).toStrictEqual([eventId(4), eventId(3)]);
    expect(first.next).toBeDefined();
    expect(Object.keys(first.rows[0] ?? {})).not.toContain("sortAt");

    const second = await repository.listAudit({ limit: 2, cursor: cursorOf(first.next) });
    expect(second.rows.map((row) => row.eventId)).toStrictEqual([eventId(2), eventId(1)]);

    const last = await repository.listAudit({ limit: 2, cursor: cursorOf(second.next) });
    expect(last.rows.map((row) => row.eventId)).toStrictEqual([eventId(5)]);
    expect(last.next).toBeUndefined();
  });

  it("answers the default page of 100 when no limit is given", async () => {
    const page = await repository.listAudit({});
    expect(page.rows).toHaveLength(5);
    expect(page.next).toBeUndefined();
  });

  it("honours the site scope, leaving out rows that name no site", async () => {
    const page = await repository.listAudit({ siteIds: [siteA] });
    expect(page.rows.map((row) => row.eventId)).toStrictEqual([eventId(2), eventId(1), eventId(5)]);
  });

  it("matches q over the action, entity type, entity id and actor id, escaping wildcards", async () => {
    expect((await repository.listAudit({ q: "ORDER" })).rows.map((row) => row.eventId)).toStrictEqual([
      eventId(3),
      eventId(1),
      eventId(5),
    ]);
    expect((await repository.listAudit({ q: "0000000000b1" })).rows.map((row) => row.eventId)).toStrictEqual([
      eventId(4),
      eventId(2),
    ]);
    expect((await repository.listAudit({ q: "%" })).rows).toStrictEqual([]);
  });

  it("combines site scope, q and the cursor", async () => {
    const first = await repository.listAudit({ siteIds: [siteA], q: "order", limit: 1 });
    expect(first.rows.map((row) => row.eventId)).toStrictEqual([eventId(1)]);
    const rest = await repository.listAudit({ siteIds: [siteA], q: "order", limit: 5, cursor: cursorOf(first.next) });
    expect(rest.rows.map((row) => row.eventId)).toStrictEqual([eventId(5)]);
  });

  it("pages reports by (occurredAt, id) with no duplicate or missing row", async () => {
    const first = await repository.report(undefined, { limit: 2 });
    expect(first.rows.map((row) => row.id)).toStrictEqual([eventId(4), eventId(3)]);

    const second = await repository.report(undefined, { limit: 2, cursor: cursorOf(first.next) });
    expect(second.rows.map((row) => row.id)).toStrictEqual([eventId(2), eventId(1)]);
    expect(second.next).toBeUndefined();
  });

  it("filters reports by type and pages within the filter", async () => {
    const first = await repository.report("payment.invoice.paid.v1", { limit: 1 });
    expect(first.rows.map((row) => row.id)).toStrictEqual([eventId(4)]);
    const second = await repository.report("payment.invoice.paid.v1", { limit: 1, cursor: cursorOf(first.next) });
    expect(second.rows.map((row) => row.id)).toStrictEqual([eventId(2)]);
    const third = await repository.report("payment.invoice.paid.v1", { limit: 1, cursor: cursorOf(second.next) });
    expect(third.rows.map((row) => row.id)).toStrictEqual([eventId(1)]);
    expect(third.next).toBeUndefined();
  });
});
