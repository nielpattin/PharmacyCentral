/** Event types the reports list holds, with the English phrase each one is shown as. */
const REPORT_TYPE_LABELS: Readonly<Record<string, string>> = {
  "sales.order.created": "Order placed",
  "sales.order.status-changed": "Order status changed",
  "sales.prescription.created": "Prescription received",
  "sales.prescription.dispensed": "Prescription dispensed",
  "sales.prescription.cancelled": "Prescription cancelled",
  "sales.prescription-consultation.requested": "Consultation requested",
  "sales.prescription-consultation.answered": "Consultation answered",
  "sales.target.set": "Sales target set",
  "payment.invoice.created": "Invoice created",
  "payment.invoice.paid": "Invoice paid",
  "payment.invoice.refunded": "Invoice refunded",
  "inventory.availability.changed": "Stock availability changed",
};

const withoutVersion = (type: string): string => type.replace(/\.v\d+$/, "");

/** The phrase for an event type such as `sales.order.status-changed.v1`, or the type without its version when unknown. */
export const reportTypeLabel = (type: string, translate: (text: string) => string): string => {
  const bare = withoutVersion(type);
  const phrase = REPORT_TYPE_LABELS[bare];
  return phrase ? translate(phrase) : bare;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sentenceCase = (key: string): string => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The facts of a report payload as "Label: value" parts. Ids are left out (the row already names its subject, and an id
 * says nothing to a reader), and so are nested values. `translate` words a label or a status value.
 */
export const reportDetails = (payload: unknown, translate: (text: string) => string): string[] => {
  let parsed: unknown = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return payload === "" ? [] : [payload];
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  return Object.entries(parsed).flatMap(([key, value]) => {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return [];
    if (typeof value === "string" && (value === "" || UUID.test(value))) return [];
    if (/Id$/.test(key)) return [];
    return [`${translate(sentenceCase(key))}: ${typeof value === "string" ? translate(value) : String(value)}`];
  });
};
