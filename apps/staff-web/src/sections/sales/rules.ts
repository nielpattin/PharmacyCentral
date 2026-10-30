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

/** The slice of an online order the processing rules read. */
export type OrderFacts = {
  status: string;
  fulfillmentType: string;
  paymentMethod: string;
  paymentStatus: string;
};

export const orderFacts = (order: Readonly<Record<string, unknown>>): OrderFacts => ({
  status: plain(order.status),
  fulfillmentType: plain(order.fulfillmentType),
  paymentMethod: plain(order.paymentMethod),
  paymentStatus: plain(order.paymentStatus),
});

const cashOnDelivery = (order: OrderFacts): boolean => order.paymentMethod === "cash_on_delivery";

/** What a staff member moves an order to, with the button label. */
export type OrderMove = { status: string; label: string };

const NEXT_MOVES: Readonly<Record<string, readonly OrderMove[]>> = {
  Pending: [{ status: "Confirmed", label: "Confirm order" }],
  Confirmed: [{ status: "Preparing", label: "Start preparing" }],
  Preparing: [{ status: "Ready", label: "Mark ready" }],
  Ready: [
    { status: "Delivering", label: "Start delivery" },
    { status: "Completed", label: "Complete order" },
  ],
  Delivering: [{ status: "Completed", label: "Complete order" }],
};

const CANCEL_MOVE: OrderMove = { status: "Cancelled", label: "Cancel order" };

/**
 * The moves sales-service accepts from staff for this order (BR-ORD-005): a pickup order is never delivered, a delivery
 * order is completed only after it went out, a QR order is confirmed by its payment, cash on delivery completes once the cash is recorded, and a paid order is
 * cancelled by refunding it, so none of those moves is offered.
 */
export const orderMoves = (order: OrderFacts): OrderMove[] => {
  const moves = (NEXT_MOVES[order.status] ?? []).filter((move) => {
    if (move.status === "Confirmed") return cashOnDelivery(order);
    if (move.status === "Delivering") return order.fulfillmentType !== "pickup";
    if (move.status === "Completed") {
      if (order.status === "Ready" && order.fulfillmentType !== "pickup") return false;
      return !cashOnDelivery(order) || order.paymentStatus === "Paid";
    }
    return true;
  });
  const cancellable = ["Pending", "Confirmed", "Preparing", "Ready"].includes(order.status);
  return cancellable && order.paymentStatus !== "Paid" ? [...moves, CANCEL_MOVE] : moves;
};

/** Cash on delivery is taken at the handover: once the order is ready or out, while its invoice is unpaid. */
export const canRecordOrderCash = (order: OrderFacts, invoiceStatus: string): boolean =>
  cashOnDelivery(order) && ["Ready", "Delivering"].includes(order.status) && canConfirmCash(invoiceStatus);

/** A paid invoice of an order that has not gone out is refunded, which cancels the order and frees its stock. */
export const canRefundOrder = (order: OrderFacts, invoiceStatus: string): boolean =>
  ["Pending", "Confirmed", "Preparing", "Ready"].includes(order.status) && canRefund(invoiceStatus);

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
  Cancelled: "neutral",
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
  Ready: "info",
  Delivering: "info",
  Completed: "success",
  Cancelled: "neutral",
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

/**
 * The batches of one product that a prescription can be dispensed from: released by quality control and not expired on
 * `today` (an ISO date). The server checks both again, so this only keeps the picker free of batches it would refuse.
 */
export const dispensableBatches = (
  batches: readonly Readonly<Record<string, unknown>>[],
  productId: string,
  today: string,
): Readonly<Record<string, unknown>>[] =>
  batches.filter(
    (batch) =>
      batch.productId === productId &&
      batch.qualityStatus === "Released" &&
      typeof batch.expiryDate === "string" &&
      batch.expiryDate.slice(0, 10) >= today,
  );

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
