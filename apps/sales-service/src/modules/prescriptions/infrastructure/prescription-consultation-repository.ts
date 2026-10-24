import { and, desc, eq, getTableColumns, inArray, isNull, or, sql } from "drizzle-orm";

import type {
  ConsultationLine,
  PrescriptionConsultation,
  PrescriptionConsultationStatus,
} from "../../../contracts/prescription-consultation.ts";
import type { SalesDatabase } from "../../../shared/infrastructure/database.ts";
import {
  afterCursor,
  clampLimit,
  containsPattern,
  createdAtSortKey,
  toPage,
} from "../../../shared/infrastructure/keyset-page.ts";
import {
  idempotencyRecords,
  outboxMessages,
  prescriptionConsultations,
} from "../../../shared/infrastructure/schema.ts";
import type { Page, PageCursor } from "../../../shared/page-cursor.ts";

/** Prescription header as the shopper's page read it, minus the flag and the lines the consultation carries itself. */
export type ConsultationPrescription = PrescriptionConsultation["prescription"];

const CREATE_SCOPE = "sales.prescriptions.consultations.create";

type ConsultationRow = typeof prescriptionConsultations.$inferSelect;

export type CreatePrescriptionConsultationInput = {
  customerId: string;
  siteId: string | null;
  source: PrescriptionConsultation["source"];
  prescription: ConsultationPrescription;
  lines: ConsultationLine[];
  note: string | null;
  idempotencyKey?: string | undefined;
};

export type CreatePrescriptionConsultationResult = {
  consultation: PrescriptionConsultation;
  /** True when the Idempotency-Key had already been seen, so nothing was written a second time. */
  replayed: boolean;
};

export type AnswerPrescriptionConsultationResult =
  | { kind: "answered"; consultation: PrescriptionConsultation }
  | { kind: "already_answered"; consultation: PrescriptionConsultation }
  | { kind: "not_found" };

const toConsultation = (row: ConsultationRow): PrescriptionConsultation => ({
  id: row.id,
  customerId: row.customerId,
  siteId: row.siteId,
  source: row.source as PrescriptionConsultation["source"],
  prescription: row.prescription,
  lines: row.lines,
  note: row.note,
  status: row.status as PrescriptionConsultationStatus,
  reply: row.reply,
  answeredBy: row.answeredBy,
  answeredAt: row.answeredAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The shopper's request for help and the pharmacist's answer to it, stored where the prescription tables cannot
 * hold it: a consultation has no product, unit, site or storage location and reserves no stock, so it cannot be a
 * `prescriptions` row. Every write appends its own outbox event in the same transaction, the way the order and
 * prescription writes in `SalesRepository` do.
 */
export class PrescriptionConsultationRepository {
  public constructor(private readonly database: SalesDatabase) {}

  public async create(input: CreatePrescriptionConsultationInput): Promise<CreatePrescriptionConsultationResult> {
    return this.database.db.transaction(async (transaction) => {
      if (input.idempotencyKey) {
        const existing = (
          await transaction
            .select()
            .from(idempotencyRecords)
            .where(
              and(
                eq(idempotencyRecords.key, input.idempotencyKey),
                eq(idempotencyRecords.scope, CREATE_SCOPE),
                eq(idempotencyRecords.actorId, input.customerId),
              ),
            )
            .limit(1)
        )[0];
        // The stored body is the first answer itself, so a retry returns the same consultation and stores nothing.
        if (existing)
          return { consultation: JSON.parse(existing.response) as PrescriptionConsultation, replayed: true };
      }
      const [row] = await transaction
        .insert(prescriptionConsultations)
        .values({
          customerId: input.customerId,
          siteId: input.siteId,
          source: input.source,
          prescription: input.prescription,
          lines: input.lines,
          note: input.note,
          status: "Open",
        })
        .returning();
      if (!row) throw new Error("Prescription consultation insert did not return a row");
      const consultation = toConsultation(row);
      await transaction.insert(outboxMessages).values({
        eventType: "sales.prescription-consultation.requested.v1",
        aggregateId: consultation.id,
        payload: JSON.stringify({
          entityType: "prescription-consultation",
          entityId: consultation.id,
          siteId: consultation.siteId,
        }),
      });
      if (input.idempotencyKey)
        await transaction.insert(idempotencyRecords).values({
          key: input.idempotencyKey,
          scope: CREATE_SCOPE,
          actorId: input.customerId,
          response: JSON.stringify(consultation),
        });
      return { consultation, replayed: false };
    });
  }

  /**
   * Newest first. The route decides who may ask for more than their own records. `q` matches the patient's name and
   * the prescription code the shopper copied, both as stored in the prescription.
   */
  public async list(input: {
    customerId?: string | undefined;
    siteIds?: string[] | undefined;
    status?: PrescriptionConsultationStatus | undefined;
    q?: string | undefined;
    after?: PageCursor | undefined;
    limit: number;
  }): Promise<Page<PrescriptionConsultation>> {
    const limit = clampLimit(input.limit, 200);
    const fetched = await this.database.db
      .select({
        ...getTableColumns(prescriptionConsultations),
        sortKey: createdAtSortKey(prescriptionConsultations.createdAt),
      })
      .from(prescriptionConsultations)
      .where(
        and(
          input.customerId ? eq(prescriptionConsultations.customerId, input.customerId) : undefined,
          // A request whose shopper picked no pharmacy belongs to no site, so every pharmacist's queue keeps it.
          input.siteIds
            ? or(inArray(prescriptionConsultations.siteId, input.siteIds), isNull(prescriptionConsultations.siteId))
            : undefined,
          input.status ? eq(prescriptionConsultations.status, input.status) : undefined,
          input.q
            ? or(
                sql`(${prescriptionConsultations.prescription}->>'patientName') ilike ${containsPattern(input.q)}`,
                sql`(${prescriptionConsultations.prescription}->>'code') ilike ${containsPattern(input.q)}`,
              )
            : undefined,
          afterCursor(prescriptionConsultations.createdAt, prescriptionConsultations.id, input.after),
        ),
      )
      .orderBy(desc(prescriptionConsultations.createdAt), desc(prescriptionConsultations.id))
      .limit(limit + 1);
    const page = toPage(fetched, limit);
    return { rows: page.rows.map(toConsultation), nextCursor: page.nextCursor };
  }

  public async get(id: string): Promise<PrescriptionConsultation | undefined> {
    const row = (
      await this.database.db
        .select()
        .from(prescriptionConsultations)
        .where(eq(prescriptionConsultations.id, id))
        .limit(1)
    )[0];
    return row ? toConsultation(row) : undefined;
  }

  /**
   * The status guard is part of the `UPDATE`, so two pharmacists answering at once cannot both win: the loser
   * finds no row to update and is told the consultation is already answered. `siteIds` narrows the answer to the
   * pharmacist's own sites plus the requests whose shopper chose no pharmacy; an out-of-scope consultation then
   * behaves exactly like a missing one, with nothing written and no event appended.
   */
  public async answer(
    id: string,
    reply: string,
    answeredBy: string,
    siteIds?: string[],
  ): Promise<AnswerPrescriptionConsultationResult> {
    return this.database.db.transaction(async (transaction): Promise<AnswerPrescriptionConsultationResult> => {
      const answeredAt = new Date();
      const scope = siteIds
        ? or(inArray(prescriptionConsultations.siteId, siteIds), isNull(prescriptionConsultations.siteId))
        : undefined;
      const [updated] = await transaction
        .update(prescriptionConsultations)
        .set({ status: "Answered", reply, answeredBy, answeredAt, updatedAt: answeredAt })
        .where(
          and(
            eq(prescriptionConsultations.id, id),
            eq(prescriptionConsultations.status, "Open"),
            ...(scope ? [scope] : []),
          ),
        )
        .returning();
      if (!updated) {
        const existing = (
          await transaction
            .select()
            .from(prescriptionConsultations)
            .where(and(eq(prescriptionConsultations.id, id), ...(scope ? [scope] : [])))
            .limit(1)
        )[0];
        if (!existing) return { kind: "not_found" };
        return { kind: "already_answered", consultation: toConsultation(existing) };
      }
      await transaction.insert(outboxMessages).values({
        eventType: "sales.prescription-consultation.answered.v1",
        aggregateId: updated.id,
        payload: JSON.stringify({
          entityType: "prescription-consultation",
          entityId: updated.id,
          siteId: updated.siteId,
          answeredBy,
        }),
      });
      return { kind: "answered", consultation: toConsultation(updated) };
    });
  }
}
