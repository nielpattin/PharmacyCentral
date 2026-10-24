import { describe, expect, it } from "vitest";

import { ALL_STATUSES, statusParam, statusTone } from "./status.ts";

describe("statusTone", () => {
  it("maps the backend status words to badge tones", () => {
    expect(statusTone("Approved")).toBe("success");
    expect(statusTone("PendingApproval")).toBe("warning");
    expect(statusTone("InTransit")).toBe("info");
    expect(statusTone("Rejected")).toBe("danger");
  });

  it("shows an unknown status as neutral", () => {
    expect(statusTone("Draft")).toBe("neutral");
    expect(statusTone("Something new")).toBe("neutral");
  });
});

describe("statusParam", () => {
  it("leaves the param out for the all filter and for an empty value", () => {
    expect(statusParam(ALL_STATUSES)).toBeUndefined();
    expect(statusParam("")).toBeUndefined();
  });

  it("passes a concrete status through", () => {
    expect(statusParam("PendingApproval")).toBe("PendingApproval");
  });
});
