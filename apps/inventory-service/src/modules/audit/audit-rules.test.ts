import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { resolveAuditEntries } from "./audit-middleware.ts";
import { INVENTORY_AUDIT_RULES } from "./audit-rules.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  plan: "00000000-0000-4000-8000-000000000002",
  site: "00000000-0000-4000-8000-000000000003",
};

/** A request as the audit middleware reads it: the matched route, the method, the params, the body and the actor header. */
const requestOf = (
  method: string,
  routePath: string,
  input: { params?: Record<string, string>; body?: Record<string, unknown> } = {},
): Request =>
  ({
    method,
    route: { path: routePath },
    params: input.params ?? {},
    body: input.body ?? {},
    header: (name: string) => (name === "x-actor-id" ? ids.actor : undefined),
  }) as unknown as Request;

describe("INVENTORY_AUDIT_RULES for action plans", () => {
  it("records a created plan with its source type, and keeps the title, the note and the owner out of the log", () => {
    const request = requestOf("POST", "/inventory/action-plans", {
      body: {
        sourceType: "expiry",
        sourceRef: "expiry:x:y",
        title: "Thu hồi lô 42",
        detail: "Ghi chú riêng",
        ownerId: ids.actor,
        dueDate: "2099-06-01",
      },
    });

    const entries = resolveAuditEntries(INVENTORY_AUDIT_RULES, request, { id: ids.plan, siteId: ids.site });

    expect(entries).toEqual([
      {
        action: "inventory.action-plan.created",
        entityType: "action-plan",
        entityId: ids.plan,
        siteId: ids.site,
        actorId: ids.actor,
        details: { sourceType: "expiry" },
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("Ghi chú riêng");
  });

  it("records an updated plan by its path id, with only the new status when the request names one", () => {
    const request = requestOf("PATCH", "/inventory/action-plans/:id", {
      params: { id: ids.plan },
      body: { status: "done", title: "Đổi tên", dueDate: "2099-06-01" },
    });

    const entries = resolveAuditEntries(INVENTORY_AUDIT_RULES, request, { id: ids.plan, siteId: ids.site });

    expect(entries).toEqual([
      {
        action: "inventory.action-plan.updated",
        entityType: "action-plan",
        entityId: ids.plan,
        siteId: ids.site,
        actorId: ids.actor,
        details: { status: "done" },
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("Đổi tên");
  });

  it("records an update that names no status without any details", () => {
    const request = requestOf("PATCH", "/inventory/action-plans/:id", {
      params: { id: ids.plan },
      body: { title: "Đổi tên" },
    });

    const [entry] = resolveAuditEntries(INVENTORY_AUDIT_RULES, request, { id: ids.plan, siteId: null });

    expect(entry).toMatchObject({ action: "inventory.action-plan.updated", entityId: ids.plan });
    expect(entry).not.toHaveProperty("details");
  });
});
