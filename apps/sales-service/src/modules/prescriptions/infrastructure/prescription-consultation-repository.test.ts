import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ConsultationLine } from "../../../contracts/prescription-consultation.ts";
import type { SalesDatabase } from "../../../shared/infrastructure/database.ts";
import * as schema from "../../../shared/infrastructure/schema.ts";
import { decodeCursor } from "../../../shared/page-cursor.ts";
import {
  PrescriptionConsultationRepository,
  type CreatePrescriptionConsultationInput,
} from "./prescription-consultation-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../../../drizzle/migrations", import.meta.url));

/**
 * The invariants under test are carried by SQL: the status guard lives in the `UPDATE` that answers a consultation,
 * the idempotency record is uniquely keyed by scope, key and actor, and every write appends its outbox event in the
 * same transaction. Running against a real Postgres engine with the real migrations is what makes an accidental
 * second answer, a duplicated row or a missing event surface as a failed statement or a missing row.
 */
describe("PrescriptionConsultationRepository", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const repository = new PrescriptionConsultationRepository({ db, pool: undefined } as unknown as SalesDatabase);

  const shopper = "00000000-0000-4000-8000-00000000000a";
  const otherShopper = "00000000-0000-4000-8000-00000000000b";
  const pharmacist = "00000000-0000-4000-8000-00000000000c";
  const secondPharmacist = "00000000-0000-4000-8000-00000000000f";
  const site = "00000000-0000-4000-8000-00000000000d";
  const otherSite = "00000000-0000-4000-8000-00000000000e";

  const prescription = {
    code: null,
    patientName: "Nguyễn Văn A",
    facilityName: null,
    doctorName: null,
    diagnosis: null,
    issuedOn: null,
  };
  const lines: ConsultationLine[] = [
    {
      rawText: "Augmentin 625mg",
      name: "Augmentin 625mg",
      activeIngredients: ["Amoxicillin"],
      strength: "625 mg",
      dosageForm: null,
      quantity: 20,
      unit: "viên",
      usage: null,
      needsHelp: true,
    },
  ];

  const create = (overrides: Partial<CreatePrescriptionConsultationInput> = {}) =>
    repository.create({
      customerId: shopper,
      siteId: site,
      source: "image",
      prescription,
      lines,
      note: "Nhờ dược sĩ tìm giúp",
      ...overrides,
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM prescription_consultations");
    await client.exec("DELETE FROM outbox_messages");
    await client.exec("DELETE FROM sales_idempotency_records");
  });

  afterAll(async () => {
    await client.close();
  });

  it("stores an open consultation and records the request for the audit consumer", async () => {
    const { consultation, replayed } = await create();

    expect(replayed).toBe(false);
    expect(consultation.status).toBe("Open");
    expect(consultation.reply).toBeNull();
    expect(consultation.answeredAt).toBeNull();
    expect(consultation.createdAt).toBe(consultation.updatedAt);
    expect(consultation.lines).toEqual(lines);

    const events = await db.select().from(schema.outboxMessages);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("sales.prescription-consultation.requested.v1");
    expect(events[0]?.aggregateId).toBe(consultation.id);
    // No patient data leaves the service: the event names the record and its store, nothing else.
    expect(JSON.parse(events[0]?.payload ?? "{}")).toEqual({
      entityType: "prescription-consultation",
      entityId: consultation.id,
      siteId: site,
    });
  });

  it("replays one idempotency key without storing a second consultation", async () => {
    const first = await create({ idempotencyKey: "consultation-create-key" });
    const retry = await create({ idempotencyKey: "consultation-create-key" });

    expect(retry.replayed).toBe(true);
    expect(retry.consultation).toEqual(first.consultation);
    const rows = await db.select().from(schema.prescriptionConsultations);
    expect(rows).toHaveLength(1);
    expect(await db.select().from(schema.outboxMessages)).toHaveLength(1);
  });

  it("scopes an idempotency key to the shopper who sent it", async () => {
    const first = await create({ idempotencyKey: "shared-key" });
    const other = await create({ customerId: otherShopper, idempotencyKey: "shared-key" });

    expect(other.replayed).toBe(false);
    expect(other.consultation.id).not.toBe(first.consultation.id);
  });

  it("answers once, timestamps the answer and records the event", async () => {
    const { consultation } = await create();

    const result = await repository.answer(consultation.id, "Dùng Amoxicillin 500mg, 3 lần mỗi ngày.", pharmacist);

    expect(result.kind).toBe("answered");
    if (result.kind !== "answered") return;
    expect(result.consultation.status).toBe("Answered");
    expect(result.consultation.reply).toBe("Dùng Amoxicillin 500mg, 3 lần mỗi ngày.");
    expect(result.consultation.answeredBy).toBe(pharmacist);
    expect(result.consultation.answeredAt).not.toBeNull();
    expect(result.consultation.createdAt).toBe(consultation.createdAt);
    expect(result.consultation.answeredAt).toBe(result.consultation.updatedAt);

    const events = await db.select().from(schema.outboxMessages);
    const answeredEvent = events.find((event) => event.eventType === "sales.prescription-consultation.answered.v1");
    expect(JSON.parse(answeredEvent?.payload ?? "{}")).toEqual({
      entityType: "prescription-consultation",
      entityId: consultation.id,
      siteId: site,
      answeredBy: pharmacist,
      actorId: pharmacist,
    });
  });

  it("refuses a second answer and keeps the first one", async () => {
    const { consultation } = await create();
    await repository.answer(consultation.id, "Câu trả lời đầu tiên.", pharmacist);

    const second = await repository.answer(consultation.id, "Câu trả lời thứ hai.", secondPharmacist);

    expect(second.kind).toBe("already_answered");
    if (second.kind !== "already_answered") return;
    expect(second.consultation.reply).toBe("Câu trả lời đầu tiên.");
    expect(second.consultation.answeredBy).toBe(pharmacist);
    const events = await db.select().from(schema.outboxMessages);
    expect(events.filter((event) => event.eventType.endsWith("answered.v1"))).toHaveLength(1);
  });

  it("reports an unknown consultation as not found", async () => {
    const missing = await repository.answer("00000000-0000-4000-8000-0000000000ff", "Câu trả lời.", pharmacist);

    expect(missing.kind).toBe("not_found");
  });

  it("answers only within the pharmacist's sites and leaves another site's request untouched", async () => {
    const other = await create({ customerId: otherShopper, siteId: otherSite });
    const unassigned = await create({ customerId: otherShopper, siteId: null });

    const outOfScope = await repository.answer(other.consultation.id, "Câu trả lời.", pharmacist, [site]);
    const unassignedAnswer = await repository.answer(unassigned.consultation.id, "Câu trả lời.", pharmacist, [site]);

    expect(outOfScope.kind).toBe("not_found");
    expect(unassignedAnswer.kind).toBe("answered");
    // The scope is part of the `UPDATE`, so a refused answer leaves the row open and appends no event.
    expect((await repository.get(other.consultation.id))?.status).toBe("Open");
    const events = await db.select().from(schema.outboxMessages);
    const answeredEvents = events.filter((event) => event.eventType.endsWith("answered.v1"));
    expect(answeredEvents.map((event) => event.aggregateId)).toEqual([unassigned.consultation.id]);
  });

  it("reports another site's answered consultation as missing rather than answered", async () => {
    const other = await create({ customerId: otherShopper, siteId: otherSite });
    await repository.answer(other.consultation.id, "Câu trả lời.", pharmacist);

    const scoped = await repository.answer(other.consultation.id, "Câu trả lời khác.", pharmacist, [site]);

    expect(scoped.kind).toBe("not_found");
    expect((await repository.get(other.consultation.id))?.reply).toBe("Câu trả lời.");
  });

  it("lists newest first, filtered by owner, status and site", async () => {
    const older = await create({ siteId: site });
    const newer = await create({ siteId: otherSite });
    // Two writes this close can share an instant, so the order under test is pinned to two distinct times.
    await db
      .update(schema.prescriptionConsultations)
      .set({ createdAt: new Date("2026-10-08T07:00:00.000Z") })
      .where(eq(schema.prescriptionConsultations.id, older.consultation.id));
    await db
      .update(schema.prescriptionConsultations)
      .set({ createdAt: new Date("2026-10-08T08:00:00.000Z") })
      .where(eq(schema.prescriptionConsultations.id, newer.consultation.id));
    await create({ customerId: otherShopper, siteId: site });
    const unassigned = await create({ customerId: otherShopper, siteId: null });
    await repository.answer(older.consultation.id, "Câu trả lời.", pharmacist);

    const own = await repository.list({ customerId: shopper, limit: 50 });
    expect(own.rows.map((row) => row.id)).toEqual([newer.consultation.id, older.consultation.id]);

    const open = await repository.list({ status: "Open", limit: 50 });
    expect(open.rows).toHaveLength(3);
    expect(open.rows.every((row) => row.status === "Open")).toBe(true);

    // A request without a pharmacy is in every site's queue, or a multi-site pharmacist could never answer it.
    const atOtherSite = await repository.list({ siteIds: [otherSite], limit: 50 });
    expect(atOtherSite.rows.map((row) => row.id).sort()).toEqual(
      [newer.consultation.id, unassigned.consultation.id].sort(),
    );
    expect((await repository.list({ siteIds: [], limit: 50 })).rows).toEqual([
      expect.objectContaining({ id: unassigned.consultation.id }),
    ]);

    // An unowned, unscoped list is the full register: it returns every shopper's rows.
    expect((await repository.list({ limit: 50 })).rows).toHaveLength(4);
  });

  it("pages newest first across instants that share a millisecond, and filters by patient or code", async () => {
    const names = ["Nguyễn An", "Trần Bình", "Lê Chi", "Phạm Dũng"];
    const made = [];
    for (const [index, patientName] of names.entries())
      made.push(
        await create({
          prescription: { ...prescription, patientName, code: index < 2 ? `CODE-${index}` : null },
        }),
      );
    // The first two rows differ by microseconds inside one millisecond, and the next pair shares an instant exactly.
    const instants = [
      "2026-10-08T07:00:00.123456Z",
      "2026-10-08T07:00:00.123400Z",
      "2026-10-08T07:00:00.123400Z",
      "2026-10-08T07:00:00.123000Z",
    ];
    for (const [index, { consultation }] of made.entries())
      await db
        .update(schema.prescriptionConsultations)
        .set({ createdAt: sql`${instants[index]}::timestamptz` })
        .where(eq(schema.prescriptionConsultations.id, consultation.id));
    const [first, second, third, fourth] = made.map((row) => row.consultation.id);
    // Equal instants are ordered by id, newest id first.
    const tied = [second, third].sort().reverse();
    const expected = [first, ...tied, fourth];

    const walk = async (limit: number, q?: string): Promise<string[]> => {
      const collected: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await repository.list({
          limit,
          q,
          after: cursor ? decodeCursor(cursor) : undefined,
        });
        collected.push(...page.rows.map((row) => row.id));
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return collected;
    };

    for (const limit of [1, 2, 3, 4, 10]) expect(await walk(limit)).toEqual(expected);
    // The last page of a list that fits in one page carries no cursor at all.
    expect((await repository.list({ limit: 10 })).nextCursor).toBeUndefined();

    expect((await repository.list({ limit: 10, q: "code-" })).rows.map((row) => row.id)).toEqual([first, second]);
    expect((await repository.list({ limit: 10, q: "Lê Chi" })).rows.map((row) => row.id)).toEqual([third]);
    // `%` and `_` are literal characters here, so a bare wildcard matches no patient or code.
    expect((await repository.list({ limit: 10, q: "%" })).rows).toEqual([]);
    expect(await walk(1, "code-")).toEqual([first, second]);
  });

  it("keeps the stored prescription and lines whole", async () => {
    const { consultation } = await create();

    const stored = await repository.get(consultation.id);

    expect(stored).toEqual(consultation);
    expect(await repository.get("00000000-0000-4000-8000-0000000000ff")).toBeUndefined();
  });
});
