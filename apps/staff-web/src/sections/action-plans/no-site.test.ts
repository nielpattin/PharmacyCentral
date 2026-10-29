import { describe, expect, it } from "vitest";

import { ApiProblemError } from "../../staff-api.ts";
import { hasNoAssignedSite, isSiteAccessRefusal } from "./no-site.ts";

describe("hasNoAssignedSite", () => {
  it("is true for an employee with no site, whether the list is empty or missing", () => {
    expect(hasNoAssignedSite({ roles: ["Pharmacist"], siteIds: [] })).toBe(true);
    expect(hasNoAssignedSite({ roles: ["Pharmacy Manager"] })).toBe(true);
  });

  it("is false for an employee with a site", () => {
    expect(hasNoAssignedSite({ roles: ["Warehouse Staff"], siteIds: ["site-1"] })).toBe(false);
  });

  it("is false for Platform Admin, who needs no assigned site", () => {
    expect(hasNoAssignedSite({ roles: ["Platform Admin"], siteIds: [] })).toBe(false);
  });

  it("does not judge a session whose roles are not known yet", () => {
    expect(hasNoAssignedSite({})).toBe(false);
  });
});

describe("isSiteAccessRefusal", () => {
  it("is true for a 403 problem and false for any other failure", () => {
    expect(isSiteAccessRefusal(new ApiProblemError("Forbidden", { status: 403 }))).toBe(true);
    expect(isSiteAccessRefusal(new ApiProblemError("Server error", { status: 500 }))).toBe(false);
    expect(isSiteAccessRefusal(new Error("network"))).toBe(false);
    expect(isSiteAccessRefusal(undefined)).toBe(false);
  });
});
