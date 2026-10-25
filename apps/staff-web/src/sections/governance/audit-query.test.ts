import { describe, expect, it } from "vitest";

import {
  AUDIT_DEFAULTS,
  AUDIT_ENTITY_TYPES,
  auditActionLabel,
  auditEntityLabel,
  auditPayloadText,
  auditRequestParams,
} from "./audit-query.ts";

describe("auditRequestParams", () => {
  it("leaves every param out for the default filters", () => {
    expect(auditRequestParams(AUDIT_DEFAULTS)).toEqual({
      q: undefined,
      entityType: undefined,
      actorId: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("maps the actor to actorId and trims the search text", () => {
    expect(auditRequestParams({ ...AUDIT_DEFAULTS, q: "  order  ", actor: "user-1" })).toMatchObject({
      q: "order",
      actorId: "user-1",
    });
    expect(auditRequestParams({ ...AUDIT_DEFAULTS, q: "   " }).q).toBeUndefined();
  });

  it("sends a from day as its first instant and a to day as its last instant", () => {
    const params = auditRequestParams({ ...AUDIT_DEFAULTS, from: "2026-10-24", to: "2026-10-25" });
    expect(params.from).toBe(new Date(2026, 9, 24).toISOString());
    expect(params.to).toBe(new Date(2026, 9, 25, 23, 59, 59, 999).toISOString());
  });

  it("drops a day that is not YYYY-MM-DD", () => {
    expect(auditRequestParams({ ...AUDIT_DEFAULTS, from: "24/10/2026", to: "" })).toMatchObject({
      from: undefined,
      to: undefined,
    });
  });
});

describe("auditEntityLabel", () => {
  it("names the known entity types and keeps any other value", () => {
    expect(auditEntityLabel("prescription-consultation")).toBe("Prescription consultation");
    expect(auditEntityLabel("site")).toBe("Site");
    expect(auditEntityLabel("something-new")).toBe("something-new");
  });

  it("lists each entity type once, so the filter has no duplicate option", () => {
    const values = AUDIT_ENTITY_TYPES.map((item) => item.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("auditActionLabel", () => {
  const same = (text: string): string => text;

  it("joins the verb and the entity, whichever tense the action uses", () => {
    expect(auditActionLabel("inventory.transfer.approve", "transfer", same)).toBe("Approve transfer");
    expect(auditActionLabel("sales.order.status-changed.v1", "order", same)).toBe("Change order status");
    expect(auditActionLabel("sales.order.status-changed.v1", "prescription", same)).toBe("Change status prescription");
    expect(auditActionLabel("catalog.product.created", "product", same)).toBe("Create product");
  });

  it("translates the verb and the entity separately", () => {
    const vietnamese = (text: string): string => ({ Approve: "Duyệt", Transfer: "Điều chuyển" })[text] ?? text;
    expect(auditActionLabel("inventory.transfer.approve", "transfer", vietnamese)).toBe("Duyệt điều chuyển");
  });

  it("keeps an acronym at the start of the entity in capitals", () => {
    expect(auditActionLabel("catalog.ai-credential.replaced", "ai-credential", same)).toBe("Replace AI credential");
  });

  it("shows sign-in and similar actions without an entity", () => {
    expect(auditActionLabel("identity.auth.login", "user", same)).toBe("Signed in");
    expect(auditActionLabel("identity.account.password-changed", "user", same)).toBe("Changed password");
  });

  it("keeps an action with an unknown verb as recorded, minus the version", () => {
    expect(auditActionLabel("billing.invoice.frobnicated.v1", "invoice", same)).toBe("billing.invoice.frobnicated");
  });
});

describe("auditPayloadText", () => {
  it("compacts a JSON string", () => {
    expect(auditPayloadText('{ "a": 1,\n "b": [2] }')).toBe('{"a":1,"b":[2]}');
  });

  it("keeps a string that is not JSON", () => {
    expect(auditPayloadText("not json")).toBe("not json");
  });

  it("serialises an object and treats a missing payload as empty", () => {
    expect(auditPayloadText({ entityId: "x" })).toBe('{"entityId":"x"}');
    expect(auditPayloadText(undefined)).toBe("{}");
  });
});
