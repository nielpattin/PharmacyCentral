import { describe, expect, it } from "vitest";

import { AUDIT_DEFAULTS, auditEntityLabel, auditPayloadText, auditRequestParams } from "./audit-query.ts";

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
    expect(auditEntityLabel("site")).toBe("site");
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
