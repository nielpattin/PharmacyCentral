export type ProjectionEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actorId?: string;
  payload: Record<string, unknown>;
};

export type AuditProjection = ProjectionEvent & {
  action: string;
  entityType: string;
  entityId?: string;
};

export class ProjectionStore {
  private readonly processedEventIds = new Set<string>();
  private readonly auditEvents: AuditProjection[] = [];
  private readonly counters = new Map<string, number>();

  public apply(event: ProjectionEvent): boolean {
    if (this.processedEventIds.has(event.eventId)) return false;
    this.processedEventIds.add(event.eventId);

    if (event.eventType.endsWith(".audit.v1")) {
      const action = typeof event.payload.action === "string" ? event.payload.action : "unknown";
      const entityType = typeof event.payload.entityType === "string" ? event.payload.entityType : "unknown";
      const entityId = typeof event.payload.entityId === "string" ? event.payload.entityId : undefined;
      this.auditEvents.push({ ...event, action, entityType, ...(entityId ? { entityId } : {}) });
    }
    const counterKey = event.eventType;
    this.counters.set(counterKey, (this.counters.get(counterKey) ?? 0) + 1);
    return true;
  }

  public listAuditEvents(): AuditProjection[] {
    return [...this.auditEvents].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  public count(eventType: string): number {
    return this.counters.get(eventType) ?? 0;
  }
}
