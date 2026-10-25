import type { Logger } from "../../logger.ts";
import type { CatalogDatabase } from "../../shared/infrastructure/database.ts";
import { outboxMessages } from "../../shared/infrastructure/schema.ts";

/** What the audit log keeps about one write. Ids are UUIDs; anything else is dropped before the entry is stored. */
export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | undefined;
  siteId?: string | undefined;
  /** The signed-in person. Undefined for an internal service acting on its own. */
  actorId?: string | undefined;
  details?: Record<string, string | number | boolean | null> | undefined;
};

export type AuditRecorder = { record(entry: AuditEntry): Promise<void> };

export const AUDIT_EVENT_TYPE = "catalog.audit.v1";

/**
 * Writes an audit entry to the outbox, from where the relay publishes it to `pharmacy.events` and operations-query
 * projects it into the audit log. A failure is logged and swallowed: the write being audited has already committed, and
 * answering it with an error would invite a retry of something that happened.
 */
export const createAuditRecorder = (database: CatalogDatabase, logger: Logger): AuditRecorder => ({
  async record(entry) {
    try {
      await database.db.insert(outboxMessages).values({
        eventType: AUDIT_EVENT_TYPE,
        schemaVersion: "1",
        payload: JSON.stringify(entry),
      });
    } catch (error) {
      logger.error({ error, action: entry.action }, "audit entry could not be recorded");
    }
  },
});
