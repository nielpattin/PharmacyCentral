import { describe, expect, it } from "vitest";

import type { Section } from "../router.ts";
import { canAccessSection, sectionRoles } from "./section-access.ts";

// The sections each role opens, written from the role-by-section table (shell spec) and the inventory ruling. Not read
// back from `sectionRoles`, so a wrong entry in the map fails here.
const opens: Record<"Pharmacist" | "Pharmacy Manager" | "Warehouse Staff", readonly Section[]> = {
  Pharmacist: [
    "account",
    "pharmacistOverview",
    "actionPlans",
    "prescriptions",
    "orders",
    "replenishment",
    "searchSynonyms",
    "inventory",
    "quality",
  ],
  "Pharmacy Manager": [
    "account",
    "dashboard",
    "analytics",
    "actionPlans",
    "prescriptions",
    "orders",
    "transfers",
    "replenishment",
    "procurement",
    "reporting",
    "finance",
    "sites",
    "storageLocations",
    "catalog",
    "searchSynonyms",
    "units",
    "pricing",
    "supplier",
    "importProducts",
    "importSites",
    "importLocations",
    "importSuppliers",
    "inventory",
    "adjustments",
    "stocktake",
    "returns",
    "quality",
  ],
  "Warehouse Staff": [
    "account",
    "dashboard",
    "actionPlans",
    "transfers",
    "replenishment",
    "importStock",
    "receiving",
    "stocktake",
    "inventory",
    "adjustments",
    "returns",
    "quality",
  ],
};

const allSections = Object.keys(sectionRoles) as Section[];

describe("sidebar sections by role", () => {
  it.each(Object.keys(opens) as Array<keyof typeof opens>)("opens exactly the table's sections for %s", (role) => {
    for (const section of allSections) {
      expect(canAccessSection(section, [role]), `${role} on ${section}`).toBe(opens[role].includes(section));
    }
  });

  it("opens every section for Platform Admin except the work screens the three working roles own", () => {
    const closed: readonly Section[] = [
      "pharmacistOverview",
      "importProducts",
      "importSites",
      "importLocations",
      "importSuppliers",
      "importStock",
    ];
    for (const section of allSections) {
      expect(canAccessSection(section, ["Platform Admin"]), section).toBe(!closed.includes(section));
    }
  });

  it("opens no section for a session with no role", () => {
    for (const section of allSections) {
      expect(canAccessSection(section, []), section).toBe(false);
    }
  });

  it("keeps Users, Audit, AI integrations and System to Platform Admin", () => {
    for (const role of ["Pharmacy Manager", "Pharmacist", "Warehouse Staff"]) {
      for (const section of ["users", "audit", "aiIntegrations", "system"] as const) {
        expect(canAccessSection(section, [role]), `${role} on ${section}`).toBe(false);
      }
    }
  });

  it("keeps Reporting away from Warehouse Staff and Pharmacist overview away from Pharmacy Manager", () => {
    expect(canAccessSection("reporting", ["Warehouse Staff"])).toBe(false);
    expect(canAccessSection("pharmacistOverview", ["Pharmacy Manager"])).toBe(false);
  });
});
