/**
 * Pure rules for the prescription, counter, consultation, and order screens: which actions a status allows, how list
 * filters become API params, and how the forms become request bodies. No React or API imports, so node can test them.
 */
import type { StatusTone } from "@pharmacy/ui";

export const ALL_STATUSES = "All";

export const PRESCRIPTION_STATUSES = [ALL_STATUSES, "Pending", "PartiallyDispensed", "Dispensed", "Cancelled"] as const;
export const INVOICE_STATUSES = [ALL_STATUSES, "Pending", "Paid", "Refunded", "Failed", "Cancelled"] as const;
export const ORDER_STATUSES = [
  ALL_STATUSES,
  "Pending",
  "Confirmed",
  "Preparing",
  "Ready",
  "Delivering",
  "Completed",
  "Cancelled",
] as const;
export const CONSULTATION_STATUSES = ["Open", "Answered"] as const;

/** Entity types the audit log can filter on for the drawers' History tab. */
export type SalesEntityType = "order" | "prescription" | "prescription-consultation";

/** The status tab named in the URL, or the fallback when the URL names a tab this list does not have. */
export const activeStatus = (value: string, statuses: readonly string[], fallback: string): string =>
  statuses.includes(value) ? value : fallback;

/** The API's `status` param for a status tab. "All" sends nothing, so the list is not filtered. */
export const statusParam = (status: string): string | undefined => (status === ALL_STATUSES ? undefined : status);

/** Search text for the API's `q`: trimmed, or undefined when empty. */
export const queryParam = (query: string): string | undefined => query.trim() || undefined;

const plain = (value: unknown): string => (typeof value === "string" ? value : "");

/** Rows of a nested list such as prescription lines. Anything that is not an object is dropped. */
export const recordList = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];

/** The first eight characters of an id, the fallback label when no name is available. */
export const shortId = (id: unknown): string => plain(id).slice(0, 8);

/** Name, email, and phone of a customer account, whichever the account holds. */
export const customerLabel = (customer: Readonly<Record<string, unknown>>): string =>
  [plain(customer.displayName), plain(customer.email), plain(customer.phoneNumber)]
    .filter((part) => part !== "")
    .join(" · ");

export const canDispense = (status: string): boolean => status === "Pending" || status === "PartiallyDispensed";

export const canCancelPrescription = (status: string): boolean =>
  status === "Draft" || status === "Pending" || status === "PartiallyDispensed";

/** An invoice prices a prescription's lines and returns the existing one when there is one, so any live prescription may get one. */
export const canCreateInvoice = (status: string): boolean => status !== "Cancelled";

export const canConfirmCash = (status: string): boolean => status === "Pending";

export const canRefund = (status: string): boolean => status === "Paid";

/**
 * An amount in its currency, in the screen's locale. Money needs a currency style, which the quantity formatter does not
 * give. A code that is not three letters shows the amount alone.
 */
export const formatAmount = (amount: unknown, currency: unknown, locale: string): string => {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (amount === null || amount === undefined || amount === "" || !Number.isFinite(value)) return "-";
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const options: Intl.NumberFormatOptions = /^[A-Z]{3}$/.test(code)
    ? { style: "currency", currency: code, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat(locale, options).format(value);
};

/** Counter invoices have no order. Invoices raised for online orders belong to the orders screen. */
export const isCounterInvoice = (invoice: Readonly<Record<string, unknown>>): boolean => plain(invoice.orderId) === "";

const PRESCRIPTION_TONES: Readonly<Record<string, StatusTone>> = {
  Draft: "neutral",
  Pending: "warning",
  PartiallyDispensed: "info",
  Dispensed: "success",
  Cancelled: "danger",
};

const PAYMENT_TONES: Readonly<Record<string, StatusTone>> = {
  Pending: "warning",
  Paid: "success",
  Failed: "danger",
  Refunded: "info",
  Cancelled: "neutral",
};

const ORDER_TONES: Readonly<Record<string, StatusTone>> = {
  Pending: "warning",
  Confirmed: "info",
  Preparing: "info",
  Ready: "accent",
  Delivering: "info",
  Completed: "success",
  Cancelled: "danger",
};

export const prescriptionTone = (status: string): StatusTone => PRESCRIPTION_TONES[status] ?? "neutral";
export const paymentTone = (status: string): StatusTone => PAYMENT_TONES[status] ?? "neutral";
export const orderTone = (status: string): StatusTone => ORDER_TONES[status] ?? "neutral";
export const consultationTone = (status: string): StatusTone => (status === "Answered" ? "success" : "warning");

export type PrescriptionHeader = {
  siteId: string;
  storageLocationId: string;
  patientName: string;
  patientPhone: string;
  customerId: string;
  doctorName: string;
  doctorLicense: string;
  notes: string;
};

export type PrescriptionLineDraft = {
  productId: string;
  productUnitId: string;
  prescribedQuantity: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes: string;
};

export const emptyPrescriptionHeader = (): PrescriptionHeader => ({
  siteId: "",
  storageLocationId: "",
  patientName: "",
  patientPhone: "",
  customerId: "",
  doctorName: "",
  doctorLicense: "",
  notes: "",
});

export const emptyPrescriptionLine = (): PrescriptionLineDraft => ({
  productId: "",
  productUnitId: "",
  prescribedQuantity: "1",
  dosage: "",
  frequency: "",
  duration: "",
  notes: "",
});

const orNull = (value: string): string | null => (value === "" ? null : value);

export const createPrescriptionBody = (
  header: PrescriptionHeader,
  lines: readonly PrescriptionLineDraft[],
): Record<string, unknown> => ({
  siteId: header.siteId,
  storageLocationId: header.storageLocationId,
  patientName: header.patientName,
  patientPhone: orNull(header.patientPhone),
  doctorName: orNull(header.doctorName),
  doctorLicense: orNull(header.doctorLicense),
  notes: orNull(header.notes),
  customerId: orNull(header.customerId),
  lines: lines.map((line) => ({
    productId: line.productId,
    productUnitId: line.productUnitId,
    prescribedQuantity: Number(line.prescribedQuantity),
    dosage: orNull(line.dosage),
    frequency: orNull(line.frequency),
    duration: orNull(line.duration),
    notes: orNull(line.notes),
  })),
});

/** Whether an editable list of lines differs from the list the form opened with. */
export const linesChanged = <T>(lines: readonly T[], initial: readonly T[]): boolean =>
  JSON.stringify(lines) !== JSON.stringify(initial);

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** How much of a prescribed line is still to dispense. Never negative. */
export const remainingQuantity = (prescribed: unknown, dispensed: unknown): number =>
  Math.max(0, toNumber(prescribed) - toNumber(dispensed));

export type DispenseLineDraft = {
  prescriptionLineId: string;
  productId: string;
  productBatchId: string;
  dispensedQuantity: string;
  /** Still to dispense when the form opened. */
  remaining: number;
};

/** Lines that still have something to dispense, each pre-filled with the whole remaining quantity. */
export const openDispenseLines = (lines: readonly Readonly<Record<string, unknown>>[]): DispenseLineDraft[] =>
  lines.flatMap((line) => {
    const remaining = remainingQuantity(line.prescribedQuantity, line.dispensedQuantity);
    if (remaining <= 0) return [];
    return [
      {
        prescriptionLineId: plain(line.id),
        productId: plain(line.productId),
        productBatchId: "",
        dispensedQuantity: String(remaining),
        remaining,
      },
    ];
  });

export const isDispenseQuantityValid = (line: DispenseLineDraft): boolean => {
  const quantity = Number(line.dispensedQuantity);
  return Number.isFinite(quantity) && quantity > 0 && quantity <= line.remaining;
};

export const dispenseBody = (lines: readonly DispenseLineDraft[]): Record<string, unknown> => ({
  lines: lines.map((line) => ({
    prescriptionLineId: line.prescriptionLineId,
    productBatchId: line.productBatchId,
    dispensedQuantity: Number(line.dispensedQuantity),
  })),
});

/**
 * A fresh key for one create or dispense attempt (32 hex characters). The server replays the stored answer for a key it
 * has seen, so a form generates a new key after the server answers, and keeps its key only while the answer is unknown.
 */
export const newIdempotencyKey = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
