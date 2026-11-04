import { describe, expect, it } from "vitest";

import type { SystemOverview, SystemService } from "../../staff-api.ts";
import { adminActionLabel, failedSignInFigure, summarizeServices, summarizeUsers } from "./admin-metrics.ts";

const service = (name: string, status: "up" | "down"): SystemService => ({
  name,
  status,
  httpStatus: null,
  latencyMs: null,
  liveStatus: status,
  liveHttpStatus: null,
  version: null,
  instances: null,
  uptimePercent24h: null,
});

describe("summarizeUsers", () => {
  it("counts employees by state and ignores customers", () => {
    const summary = summarizeUsers([
      { id: "1", actorType: "employee", isActive: true, roles: ["Pharmacist"] },
      { id: "2", actorType: "employee", isActive: true, roles: [] },
      { id: "3", actorType: "employee", isActive: false, roles: [] },
      { id: "4", actorType: "customer", isActive: true, roles: [] },
    ]);
    expect(summary).toEqual({ active: 2, deactivated: 1, withoutRole: 1 });
  });

  it("does not flag a deactivated account for having no role", () => {
    expect(summarizeUsers([{ id: "1", actorType: "employee", isActive: false, roles: [] }]).withoutRole).toBe(0);
  });
});

describe("summarizeServices", () => {
  it("counts the services that are up and names the ones that are not", () => {
    const overview = {
      services: { status: "ok", data: [service("identity-service", "up"), service("catalog-service", "down")] },
    } as Pick<SystemOverview, "services">;
    expect(summarizeServices(overview)).toEqual({ up: 1, total: 2, down: ["catalog-service"] });
  });

  it("answers null when the section did not load, never a zero", () => {
    expect(summarizeServices({ services: { status: "unavailable", error: "timeout" } })).toBeNull();
    expect(summarizeServices(undefined)).toBeNull();
  });
});

describe("failedSignInFigure", () => {
  const format = (value: number): string => String(value);
  it("shows the exact count below the limit and a plus at it", () => {
    expect(failedSignInFigure(0, format)).toBe("0");
    expect(failedSignInFigure(7, format)).toBe("7");
    expect(failedSignInFigure(100, format)).toBe("100+");
  });
});

describe("adminActionLabel", () => {
  const translate = (text: string): string => text;
  it("names a refused sign-in, which the audit labels do not know", () => {
    expect(adminActionLabel("identity.auth.login-failed", "user", translate)).toBe("Failed sign-in");
    expect(adminActionLabel("identity.auth.login-failed.v1", "user", translate)).toBe("Failed sign-in");
  });

  it("leaves every other action to the audit labels", () => {
    expect(adminActionLabel("identity.auth.login", "user", translate)).toBe("Signed in");
  });
});
