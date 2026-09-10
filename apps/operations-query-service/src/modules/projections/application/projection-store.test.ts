import { describe, expect, it } from "vitest";

import { ProjectionStore } from "./projection-store.ts";

describe("operations projections", () => {
  it("deduplicates redelivered events and keeps audit data append-only", () => {
    const store = new ProjectionStore();
    const event = {
      eventId: "event-1",
      eventType: "identity.audit.v1",
      occurredAt: "2026-01-01T00:00:00Z",
      payload: { action: "create", entityType: "User", entityId: "user-1" },
    };
    expect(store.apply(event)).toBe(true);
    expect(store.apply(event)).toBe(false);
    expect(store.count(event.eventType)).toBe(1);
    expect(store.listAuditEvents()).toHaveLength(1);
  });
});
