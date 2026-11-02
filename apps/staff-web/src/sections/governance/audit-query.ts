import type { ListValues } from "../../lib/list-url-state.ts";

/** The audit list's URL keys and defaults. `actor` is an employee id, sent to the API as `actorId`. */
export const AUDIT_DEFAULTS = { q: "", entityType: "", actor: "", from: "", to: "" } as const;
export type AuditValues = ListValues<typeof AUDIT_DEFAULTS>;

type AuditEntityType = { value: string; label: string };

/** The entity types the audit log records, grouped by the area that writes them, with the English label each is shown under. */
export const AUDIT_ENTITY_GROUPS: ReadonlyArray<{ label: string; types: readonly AuditEntityType[] }> = [
  {
    label: "Sales",
    types: [
      { value: "order", label: "Order" },
      { value: "prescription", label: "Prescription" },
      { value: "prescription-consultation", label: "Prescription consultation" },
    ],
  },
  {
    label: "Catalog",
    types: [
      { value: "product", label: "Product" },
      { value: "product-unit", label: "Product unit" },
      { value: "product-import", label: "Product import" },
      { value: "price", label: "Price" },
      { value: "site", label: "Site" },
      { value: "storage-location", label: "Storage location" },
      { value: "supplier", label: "Supplier" },
      { value: "search-synonym-group", label: "Search synonym group" },
      { value: "ai-credential", label: "AI credential" },
    ],
  },
  {
    label: "Inventory",
    types: [
      { value: "batch", label: "Batch" },
      { value: "adjustment", label: "Adjustment" },
      { value: "disposal", label: "Disposal record" },
      { value: "movement", label: "Movement" },
      { value: "transfer", label: "Transfer" },
      { value: "stocktake", label: "Stocktake" },
      { value: "stocktake-line", label: "Stocktake line" },
      { value: "return", label: "Return" },
      { value: "replenishment", label: "Replenishment" },
      { value: "inventory-import", label: "Inventory import" },
    ],
  },
  {
    label: "Procurement",
    types: [
      { value: "purchase-order", label: "Purchase order" },
      { value: "goods-receipt", label: "Goods receipt" },
    ],
  },
  { label: "Identity", types: [{ value: "user", label: "User" }] },
];

export const AUDIT_ENTITY_TYPES: readonly AuditEntityType[] = AUDIT_ENTITY_GROUPS.flatMap((group) => group.types);

export const auditEntityLabel = (entityType: string): string =>
  AUDIT_ENTITY_TYPES.find((item) => item.value === entityType)?.label ?? entityType;

/**
 * The verb at the end of an action such as `inventory.transfer.approve` or `sales.order.status-changed.v1`, with the
 * English label it is shown under. A route that carries the verb in its path gives the imperative, the others the past
 * tense, so both spellings map to one label.
 */
const AUDIT_VERBS: Readonly<Record<string, string>> = {
  create: "Create",
  created: "Create",
  update: "Update",
  updated: "Update",
  delete: "Delete",
  deleted: "Delete",
  imported: "Import",
  recorded: "Record",
  counted: "Count",
  posted: "Post",
  requested: "Request",
  approve: "Approve",
  approved: "Approve",
  reject: "Reject",
  rejected: "Reject",
  ship: "Ship",
  receive: "Receive",
  cancel: "Cancel",
  cancelled: "Cancel",
  fulfill: "Fulfill",
  publish: "Publish",
  archive: "Archive",
  dispensed: "Dispense",
  answered: "Answer",
  replaced: "Replace",
  cleared: "Clear",
  "status-changed": "Change status",
  "image-updated": "Update image",
  "quality-reviewed": "Review quality",
  "access-updated": "Update access",
  "profile-updated": "Update profile",
  "password-reset": "Reset password",
};

/**
 * Verb and entity pairs whose plain "verb entity" join reads badly ("Change status order", "Dispense prescription" in
 * Vietnamese word order), keyed by `<verb label>|<entity type>`, with the English phrase shown instead.
 */
const AUDIT_PHRASES: Readonly<Record<string, string>> = {
  "Dispense|prescription": "Dispense prescription",
  "Change status|order": "Change order status",
  "Review quality|batch": "Review batch quality",
  "Update access|user": "Update user access",
  "Update profile|user": "Update user profile",
  "Reset password|user": "Reset user password",
  "Update image|product": "Update product image",
};

/** Verbs that read as a whole sentence without an entity after them: signing in, changing one's own password. */
const AUDIT_STANDALONE_VERBS: Readonly<Record<string, string>> = {
  login: "Signed in",
  "password-changed": "Changed password",
  "profile-updated": "Updated profile",
  setup: "Created first administrator",
};

/** Lowercases the first letter of a sentence-case label, except when the word is an acronym such as "AI". */
const startLowercase = (label: string): string =>
  /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);

/**
 * A readable name for an audit action, for example "Approve transfer" for `inventory.transfer.approve`. `translate`
 * turns each English part into the interface language. An action with a verb it does not know is shown as recorded,
 * minus its version suffix, so a new action never disappears from the log.
 */
export const auditActionLabel = (action: string, entityType: string, translate: (text: string) => string): string => {
  const bare = action.replace(/\.v\d+$/, "");
  const verb = bare.slice(bare.lastIndexOf(".") + 1);
  const standalone = AUDIT_STANDALONE_VERBS[verb];
  if (standalone) return translate(standalone);
  const known = AUDIT_VERBS[verb];
  if (!known) return bare;
  const phrase = AUDIT_PHRASES[`${known}|${entityType}`];
  if (phrase) return translate(phrase);
  const entity = translate(auditEntityLabel(entityType));
  return `${translate(known)} ${startLowercase(entity)}`;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The instant a `YYYY-MM-DD` day starts, or ends, in the viewer's time zone, as ISO 8601. Undefined when not a day. */
const dayBound = (day: string, end: boolean): string | undefined => {
  const match = DAY.exec(day);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const date = Number(match[3]);
  const instant = end ? new Date(year, month, date, 23, 59, 59, 999) : new Date(year, month, date);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
};

/** Query params of the audit list for the current filters. Empty filters are left out of the request. */
export const auditRequestParams = (values: AuditValues): Record<string, string | undefined> => ({
  q: values.q.trim() || undefined,
  entityType: values.entityType || undefined,
  actorId: values.actor || undefined,
  from: dayBound(values.from, false),
  to: dayBound(values.to, true),
});

/** The payload on one line, for the table and the CSV. A payload that is not JSON is shown as it is. */
export const auditPayloadText = (payload: unknown): string => {
  if (typeof payload === "string") {
    try {
      return JSON.stringify(JSON.parse(payload));
    } catch {
      return payload;
    }
  }
  return JSON.stringify(payload ?? {});
};
