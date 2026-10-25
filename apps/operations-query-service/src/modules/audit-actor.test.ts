import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OperationsDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { OperationsRepository, type IntegrationEvent } from "./operations-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle/migrations", import.meta.url));

const actor = "00000000-0000-4000-8000-0000000000a1";
const entity = "00000000-0000-4000-8000-0000000000b2";
const site = "00000000-0000-4000-8000-0000000000c3";
const eventId = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describe("audit entries from the services' events", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new OperationsRepository({ db, pool: undefined } as unknown as OperationsDatabase, {});

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });
  afterAll(async () => {
    await client.close();
  });

  const apply = (event: Partial<IntegrationEvent> & Pick<IntegrationEvent, "eventId" | "eventType">) =>
    repository.apply({ occurredAt: "2026-10-25T08:00:00.000Z", payload: {}, ...event });

  it("keeps the actor, entity and site of a catalog, inventory or identity audit event", async () => {
    await apply({
      eventId: eventId(1),
      eventType: "catalog.audit.v1",
      actorId: actor,
      payload: { action: "catalog.product.updated", entityType: "product", entityId: entity, siteId: site },
    });
    const [row] = (await repository.listAudit({ q: "catalog.product.updated" })).rows;
    expect(row).toMatchObject({
      action: "catalog.product.updated",
      entityType: "product",
      entityId: entity,
      siteId: site,
      actorId: actor,
    });
  });

  it("reads the actor of a sales event from its payload when the envelope has none", async () => {
    await apply({
      eventId: eventId(2),
      eventType: "sales.prescription.dispensed.v1",
      payload: { prescriptionId: entity, actorId: actor },
    });
    const [row] = (await repository.listAudit({ q: "prescription.dispensed" })).rows;
    expect(row).toMatchObject({ entityType: "prescription", entityId: entity, actorId: actor });
  });

  it("leaves the actor empty for a system event such as an order expiring", async () => {
    await apply({
      eventId: eventId(3),
      eventType: "sales.order.status-changed.v1",
      payload: { orderId: entity, status: "Cancelled" },
    });
    const [row] = (await repository.listAudit({ q: "order.status-changed" })).rows;
    expect(row?.actorId).toBeNull();
  });

  it("keeps audit events out of the report rows, which are figures rather than a record of who did what", async () => {
    await apply({
      eventId: eventId(5),
      eventType: "catalog.audit.v1",
      actorId: actor,
      payload: { action: "catalog.site.created", entityType: "site", entityId: entity },
    });
    await apply({ eventId: eventId(6), eventType: "payment.invoice.paid.v1", payload: { amount: 5 } });
    const types = (await repository.report(undefined)).rows.map((row) => row.reportType);
    expect(types).toContain("payment.invoice.paid.v1");
    expect(types.some((type) => type.endsWith(".audit.v1"))).toBe(false);
  });

  it("ignores an actor that is not a UUID", async () => {
    await apply({
      eventId: eventId(4),
      eventType: "inventory.audit.v1",
      actorId: "not-a-uuid",
      payload: { action: "inventory.transfer.created", entityType: "transfer", entityId: entity },
    });
    const [row] = (await repository.listAudit({ q: "transfer.created" })).rows;
    expect(row?.actorId).toBeNull();
  });
});
