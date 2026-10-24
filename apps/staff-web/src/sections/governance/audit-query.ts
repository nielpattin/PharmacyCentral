import type { ListValues } from "../../lib/list-url-state.ts";

/** The audit list's URL keys and defaults. `actor` is an employee id, sent to the API as `actorId`. */
export const AUDIT_DEFAULTS = { q: "", entityType: "", actor: "", from: "", to: "" } as const;
export type AuditValues = ListValues<typeof AUDIT_DEFAULTS>;

/** The entity types the audit log records, with the English label each is shown under. */
export const AUDIT_ENTITY_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "order", label: "Order" },
  { value: "prescription", label: "Prescription" },
  { value: "prescription-consultation", label: "Prescription consultation" },
];

export const auditEntityLabel = (entityType: string): string =>
  AUDIT_ENTITY_TYPES.find((item) => item.value === entityType)?.label ?? entityType;

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
