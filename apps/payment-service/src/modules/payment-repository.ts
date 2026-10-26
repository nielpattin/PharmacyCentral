import { and, asc, desc, eq, getTableColumns, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import type { PaymentDatabase } from "../shared/infrastructure/database.ts";
import type { PageCursor } from "./page-cursor.ts";
import {
  paymentAttempts,
  paymentInvoiceLines,
  paymentInvoices,
  paymentRefunds,
  paymentTransactions,
  reconciliationRecords,
  outboxMessages,
} from "./payments/infrastructure/schema.ts";

export type InvoicePaymentMethod = "sepay_qr" | "cash_on_delivery" | "cash";
export type InvoiceStatus = "Pending" | "Paid" | "Failed" | "Refunded" | "Cancelled";

export type InvoiceListInput = {
  customerId?: string | undefined;
  status?: InvoiceStatus | undefined;
  /** Case-insensitive substring over the invoice number, the order id and the customer id. */
  q?: string | undefined;
  /** Undefined answers the whole list; a number answers one keyset page of that many invoices. */
  limit?: number | undefined;
  cursor?: PageCursor | undefined;
};

export type InvoiceListPage<Row> = { rows: Row[]; next: PageCursor | undefined };

/** The sort value of a row as UTC text with microseconds, so a cursor built from it compares exactly. */
const sortAtSql = sql<string>`to_char(${paymentInvoices.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Escapes LIKE wildcards so a typed `%` or `_` matches itself. Postgres ILIKE uses backslash as its escape. */
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

const invoiceTextMatch = (text: string): SQL => {
  const pattern = likePattern(text);
  return or(
    ilike(paymentInvoices.paymentCode, pattern),
    sql`${paymentInvoices.orderId}::text ilike ${pattern}`,
    sql`${paymentInvoices.customerId}::text ilike ${pattern}`,
  ) as SQL;
};

export class PaymentRepository {
  public constructor(private readonly database: PaymentDatabase) {}

  public async createInvoice(input: {
    invoiceId: string;
    customerId?: string | undefined;
    orderId?: string | undefined;
    prescriptionId?: string | undefined;
    paymentMethod: InvoicePaymentMethod;
    lines: Array<{
      /** Absent on a line that is not a product, such as the delivery fee. */
      productId?: string | undefined;
      productUnitId?: string | undefined;
      description: string;
      quantity: number;
      unitPrice: number;
      currency: string;
    }>;
  }) {
    return this.database.db.transaction(async (transaction) => {
      const amount = roundMoney(input.lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0));
      const currency = input.lines[0]?.currency ?? "VND";
      if (currency !== "VND") throw new Error("Only VND invoices are supported");
      const paymentCode = `PC-${input.invoiceId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
      const existing = (
        await transaction.select().from(paymentInvoices).where(eq(paymentInvoices.id, input.invoiceId)).limit(1)
      )[0];
      if (existing) return this.withInvoiceDetails(transaction, existing);
      const [invoice] = await transaction
        .insert(paymentInvoices)
        .values({
          id: input.invoiceId,
          paymentCode,
          customerId: input.customerId ?? null,
          orderId: input.orderId ?? null,
          prescriptionId: input.prescriptionId ?? null,
          amount: String(amount),
          currency,
          status: "Pending",
        })
        .returning();
      if (!invoice) throw new Error("Invoice insert did not return a row");
      await transaction.insert(paymentInvoiceLines).values(
        input.lines.map((line) => ({
          paymentInvoiceId: invoice.id,
          productId: line.productId ?? null,
          productUnitId: line.productUnitId ?? null,
          description: line.description,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
          currency: line.currency,
        })),
      );
      await transaction.insert(paymentAttempts).values({
        paymentInvoiceId: invoice.id,
        provider: input.paymentMethod === "cash" ? "counter" : "sepay",
        method: input.paymentMethod,
        amount: String(amount),
        status: "Pending",
        providerMetadata: JSON.stringify({ paymentCode }),
      });
      await transaction
        .insert(reconciliationRecords)
        .values({ paymentInvoiceId: invoice.id, expectedAmount: String(amount), receivedAmount: "0", state: "Open" });
      await transaction.insert(outboxMessages).values({
        eventType: "payment.invoice.created.v1",
        aggregateId: invoice.id,
        payload: JSON.stringify({
          invoiceId: invoice.id,
          orderId: invoice.orderId,
          prescriptionId: invoice.prescriptionId,
          paymentCode,
          amount,
          currency,
        }),
      });
      return this.withInvoiceDetails(transaction, invoice);
    });
  }

  public async getInvoiceByPrescription(prescriptionId: string) {
    const invoice = (
      await this.database.db
        .select()
        .from(paymentInvoices)
        .where(eq(paymentInvoices.prescriptionId, prescriptionId))
        .orderBy(desc(paymentInvoices.createdAt))
        .limit(1)
    )[0];
    return invoice ? this.withInvoiceDetails(this.database.db, invoice) : undefined;
  }

  public async getInvoice(id: string) {
    const invoice = (
      await this.database.db.select().from(paymentInvoices).where(eq(paymentInvoices.id, id)).limit(1)
    )[0];
    return invoice ? this.withInvoiceDetails(this.database.db, invoice) : undefined;
  }

  /**
   * Newest first by `(createdAt, id)`. Without a limit the answer is the whole filtered list. With a limit it is one
   * keyset page: `limit + 1` rows are read so the page knows whether another row follows.
   */
  public async listInvoices(input: InvoiceListInput): Promise<InvoiceListPage<typeof paymentInvoices.$inferSelect>> {
    const conditions = [
      input.customerId ? eq(paymentInvoices.customerId, input.customerId) : undefined,
      input.status ? eq(paymentInvoices.status, input.status) : undefined,
      input.q ? invoiceTextMatch(input.q) : undefined,
      input.cursor
        ? sql`(${paymentInvoices.createdAt}, ${paymentInvoices.id}) < (${input.cursor.sortAt}::timestamptz, ${input.cursor.id}::uuid)`
        : undefined,
    ].filter((condition): condition is SQL => condition !== undefined);
    const base = this.database.db
      .select({ ...getTableColumns(paymentInvoices), sortAt: sortAtSql })
      .from(paymentInvoices)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(paymentInvoices.createdAt), desc(paymentInvoices.id));
    const fetched = input.limit === undefined ? await base : await base.limit(input.limit + 1);
    const visible = input.limit === undefined ? fetched : fetched.slice(0, input.limit);
    const last = visible.at(-1);
    const hasMore = input.limit !== undefined && fetched.length > input.limit;
    return {
      rows: visible.map(({ sortAt: _sortAt, ...invoice }) => invoice),
      next: hasMore && last ? { sortAt: last.sortAt, id: last.id } : undefined,
    };
  }

  public async markCashPaid(id: string, actorId?: string) {
    return this.database.db.transaction(async (transaction) => {
      const invoice = (await transaction.select().from(paymentInvoices).where(eq(paymentInvoices.id, id)).limit(1))[0];
      if (!invoice) return undefined;
      if (invoice.status !== "Pending") throw new Error("Only pending invoices can be paid");
      await transaction
        .insert(paymentTransactions)
        .values({
          paymentInvoiceId: id,
          provider: "counter",
          providerTransactionId: `cash-${id}`,
          amount: invoice.amount,
        })
        .onConflictDoNothing();
      const [updated] = await transaction
        .update(paymentInvoices)
        .set({ status: "Paid", updatedAt: new Date() })
        .where(and(eq(paymentInvoices.id, id), eq(paymentInvoices.status, "Pending")))
        .returning();
      await transaction
        .update(paymentAttempts)
        .set({ status: "Succeeded", updatedAt: new Date() })
        .where(and(eq(paymentAttempts.paymentInvoiceId, id), eq(paymentAttempts.status, "Pending")));
      await transaction
        .update(reconciliationRecords)
        .set({ receivedAmount: invoice.amount, state: "Matched", updatedAt: new Date() })
        .where(eq(reconciliationRecords.paymentInvoiceId, id));
      await transaction.insert(outboxMessages).values({
        eventType: "payment.invoice.paid.v1",
        aggregateId: id,
        payload: JSON.stringify({
          invoiceId: id,
          orderId: invoice.orderId,
          provider: "counter",
          actorId: actorId ?? null,
          amount: Number(invoice.amount),
          currency: invoice.currency,
        }),
      });
      return updated ? this.withInvoiceDetails(transaction, updated) : undefined;
    });
  }

  public async applyProviderTransaction(input: {
    paymentCodes: string[];
    provider: string;
    providerTransactionId: string;
    amount: number;
    metadata?: Record<string, unknown>;
  }) {
    return this.database.db.transaction(async (transaction) => {
      const matching = await transaction
        .select()
        .from(paymentInvoices)
        .where(inArray(paymentInvoices.paymentCode, input.paymentCodes));
      let invoice: (typeof matching)[number] | undefined;
      for (const paymentCode of input.paymentCodes) {
        invoice = matching.find((candidate) => candidate.paymentCode === paymentCode);
        if (invoice) break;
      }
      if (!invoice) return undefined;
      const existingTransaction = (
        await transaction
          .select()
          .from(paymentTransactions)
          .where(
            and(
              eq(paymentTransactions.provider, input.provider),
              eq(paymentTransactions.providerTransactionId, input.providerTransactionId),
            ),
          )
          .limit(1)
      )[0];
      if (existingTransaction)
        return { invoiceId: invoice.id, duplicate: true, status: invoice.status, reason: "duplicate_transaction" };
      await transaction.insert(paymentTransactions).values({
        paymentInvoiceId: invoice.id,
        provider: input.provider,
        providerTransactionId: input.providerTransactionId,
        amount: String(input.amount),
      });
      if (Number(invoice.amount) !== input.amount) {
        await transaction
          .update(paymentAttempts)
          .set({
            status: "Failed",
            providerMetadata: JSON.stringify({ reason: "amount_mismatch", ...input.metadata }),
            updatedAt: new Date(),
          })
          .where(and(eq(paymentAttempts.paymentInvoiceId, invoice.id), eq(paymentAttempts.status, "Pending")));
        await transaction
          .update(reconciliationRecords)
          .set({ receivedAmount: String(input.amount), state: "AmountMismatch", updatedAt: new Date() })
          .where(eq(reconciliationRecords.paymentInvoiceId, invoice.id));
        return { invoiceId: invoice.id, duplicate: false, status: invoice.status, reason: "amount_mismatch" };
      }
      if (invoice.status === "Pending") {
        await transaction
          .update(paymentInvoices)
          .set({ status: "Paid", updatedAt: new Date() })
          .where(and(eq(paymentInvoices.id, invoice.id), eq(paymentInvoices.status, "Pending")));
        await transaction
          .update(paymentAttempts)
          .set({ status: "Succeeded", providerMetadata: JSON.stringify(input.metadata ?? {}), updatedAt: new Date() })
          .where(and(eq(paymentAttempts.paymentInvoiceId, invoice.id), eq(paymentAttempts.status, "Pending")));
        await transaction
          .update(reconciliationRecords)
          .set({ receivedAmount: String(input.amount), state: "Matched", updatedAt: new Date() })
          .where(eq(reconciliationRecords.paymentInvoiceId, invoice.id));
        await transaction.insert(outboxMessages).values({
          eventType: "payment.invoice.paid.v1",
          aggregateId: invoice.id,
          payload: JSON.stringify({
            invoiceId: invoice.id,
            orderId: invoice.orderId,
            provider: input.provider,
            providerTransactionId: input.providerTransactionId,
            amount: input.amount,
            currency: invoice.currency,
          }),
        });
        return { invoiceId: invoice.id, duplicate: false, status: "Paid", reason: "accepted" };
      }
      return { invoiceId: invoice.id, duplicate: false, status: invoice.status, reason: "already_settled" };
    });
  }

  public async refund(id: string, reason: string, actorId?: string) {
    return this.database.db.transaction(async (transaction) => {
      const invoice = (await transaction.select().from(paymentInvoices).where(eq(paymentInvoices.id, id)).limit(1))[0];
      if (!invoice) return undefined;
      if (invoice.status !== "Paid") throw new Error("Only paid invoices can be refunded");
      await transaction
        .insert(paymentRefunds)
        .values({ paymentInvoiceId: id, amount: invoice.amount, reason, createdBy: actorId ?? null });
      const [updated] = await transaction
        .update(paymentInvoices)
        .set({ status: "Refunded", updatedAt: new Date() })
        .where(and(eq(paymentInvoices.id, id), eq(paymentInvoices.status, "Paid")))
        .returning();
      await transaction.insert(outboxMessages).values({
        eventType: "payment.invoice.refunded.v1",
        aggregateId: id,
        payload: JSON.stringify({
          invoiceId: id,
          orderId: invoice.orderId,
          reason,
          actorId: actorId ?? null,
          amount: Number(invoice.amount),
          currency: invoice.currency,
        }),
      });
      return updated ? this.withInvoiceDetails(transaction, updated) : undefined;
    });
  }

  public async printableInvoice(id: string) {
    const invoice = await this.getInvoice(id);
    if (!invoice) return undefined;
    return {
      invoiceNumber: invoice.paymentCode,
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      customerId: invoice.customerId,
      currency: invoice.currency,
      amount: Number(invoice.amount),
      status: invoice.status,
      issuedAt: invoice.createdAt,
      lines: invoice.lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        total: Number(line.quantity) * Number(line.unitPrice),
        currency: line.currency,
      })),
    };
  }

  private async withInvoiceDetails(
    database: { select: PaymentDatabase["db"]["select"] },
    invoice: typeof paymentInvoices.$inferSelect,
  ) {
    const [lines, attempts, transactions, refunds, reconciliation] = await Promise.all([
      database
        .select()
        .from(paymentInvoiceLines)
        .where(eq(paymentInvoiceLines.paymentInvoiceId, invoice.id))
        .orderBy(asc(paymentInvoiceLines.id)),
      database
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.paymentInvoiceId, invoice.id))
        .orderBy(desc(paymentAttempts.createdAt)),
      database
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.paymentInvoiceId, invoice.id))
        .orderBy(desc(paymentTransactions.receivedAt)),
      database
        .select()
        .from(paymentRefunds)
        .where(eq(paymentRefunds.paymentInvoiceId, invoice.id))
        .orderBy(desc(paymentRefunds.createdAt)),
      database
        .select()
        .from(reconciliationRecords)
        .where(eq(reconciliationRecords.paymentInvoiceId, invoice.id))
        .limit(1),
    ]);
    return {
      ...invoice,
      lines,
      attempts,
      transactions,
      refunds,
      reconciliation: reconciliation[0],
      paymentInstruction:
        invoice.status === "Pending"
          ? createPaymentInstruction(invoice.paymentCode, Number(invoice.amount))
          : undefined,
    };
  }
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const createPaymentInstruction = (paymentCode: string, amount: number) => {
  const bank = process.env.PHARMACY_PAYMENT_SEPAY_BANK;
  if (!bank)
    throw new Error(
      "Missing required environment variable: PHARMACY_PAYMENT_SEPAY_BANK. Please set it in your .env file.",
    );
  const accountNumber = process.env.PHARMACY_PAYMENT_SEPAY_ACCOUNT_NUMBER;
  if (!accountNumber)
    throw new Error(
      "Missing required environment variable: PHARMACY_PAYMENT_SEPAY_ACCOUNT_NUMBER. Please set it in your .env file.",
    );
  const baseUrl = process.env.PHARMACY_PAYMENT_SEPAY_QR_BASE_URL;
  if (!baseUrl)
    throw new Error(
      "Missing required environment variable: PHARMACY_PAYMENT_SEPAY_QR_BASE_URL. Please set it in your .env file.",
    );
  const qrImageUrl = `${baseUrl}?acc=${encodeURIComponent(accountNumber)}&bank=${encodeURIComponent(bank)}&amount=${amount}&des=${encodeURIComponent(paymentCode)}`;
  return {
    provider: "sepay",
    method: "sepay_qr",
    bank,
    accountNumber,
    transferContent: paymentCode,
    amount,
    currency: "VND",
    qrImageUrl,
  };
};
