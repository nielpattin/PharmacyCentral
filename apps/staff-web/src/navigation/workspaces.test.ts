import { describe, expect, it } from "vitest";

import type { Section } from "../router.ts";
import { sectionRoles } from "../permissions/section-access.ts";
import {
  filterPaletteEntries,
  landingSection,
  pageForSection,
  paletteEntries,
  searchKey,
  visibleWorkspaces,
  type VisibleWorkspace,
} from "./workspaces.ts";

const labels = (workspaces: readonly VisibleWorkspace[]): string[] =>
  workspaces.map((workspace) => (workspace.flat ? (workspace.pages[0]?.label ?? workspace.label) : workspace.label));

const allSections = Object.keys(sectionRoles) as Section[];

describe("workspace navigation", () => {
  it("puts every route except the account page in exactly one page", () => {
    for (const section of allSections.filter((candidate) => candidate !== "account")) {
      const location = pageForSection(section);
      expect(location, section).toBeDefined();
      expect(location?.page.entries, section).toContain(section);
    }
    expect(pageForSection("account")).toBeUndefined();
  });

  it.each([
    [
      "Platform Admin",
      [
        // Analytics is the manager's, so the administrator's Overview holds the Dashboard alone and flattens to it. Action
        // plans, the Pharmacy counter and Finance are the pharmacy's work and money, so the administrator has none.
        "Dashboard",
        "Inventory",
        "Purchasing",
        "Catalog",
        "Administration",
      ],
    ],
    [
      "Pharmacy Manager",
      ["Overview", "Action plans", "Pharmacy counter", "Inventory", "Purchasing", "Finance", "Catalog"],
    ],
    ["Pharmacist", ["Action plans", "Pharmacy counter", "Inventory", "Search synonyms"]],
    ["Warehouse Staff", ["Dashboard", "Action plans", "Inventory", "Purchasing"]],
  ] as const)("shows %s these first-level items", (role, expected) => {
    expect(labels(visibleWorkspaces([role]))).toEqual(expected);
  });

  it("flattens a workspace with one page instead of showing a one-child parent", () => {
    const pharmacist = visibleWorkspaces(["Pharmacist"]);
    const catalog = pharmacist.find((workspace) => workspace.id === "catalog");
    expect(catalog?.flat).toBe(true);
    expect(catalog?.pages[0]?.label).toBe("Search synonyms");

    const warehouse = visibleWorkspaces(["Warehouse Staff"]);
    expect(warehouse.find((workspace) => workspace.id === "overview")?.flat).toBe(true);
    expect(warehouse.find((workspace) => workspace.id === "purchasing")?.flat).toBe(true);
  });

  it("keeps the page a role can open when another entry in the page is closed", () => {
    const warehousePurchasing = visibleWorkspaces(["Warehouse Staff"]).find(
      (workspace) => workspace.id === "purchasing",
    );
    expect(warehousePurchasing?.pages[0]?.section).toBe("receiving");
    expect(warehousePurchasing?.pages[0]?.path).toBe("/receiving");

    const managerCounter = visibleWorkspaces(["Pharmacy Manager"]).find((workspace) => workspace.id === "counter");
    expect(managerCounter?.pages[0]?.section).toBe("prescriptions");
    expect(managerCounter?.pages[0]?.path).toBe("/prescriptions");
  });

  it("marks every route that opens the same page as one page", () => {
    expect(pageForSection("quality")?.page.id).toBe("inventory");
    expect(pageForSection("transfers")?.page.id).toBe("inventory");
    expect(pageForSection("receiving")?.page.id).toBe("purchasing");
    expect(pageForSection("audit")?.page.id).toBe("users");
    expect(pageForSection("importProducts")?.page.id).toBe("importProducts");
  });

  it("searches all pages a role can open, including the hidden imports and the account page", () => {
    const manager = paletteEntries(["Pharmacy Manager"]);
    const sections = manager.map((entry) => entry.section);
    expect(new Set(sections).size).toBe(sections.length);
    expect(sections).toEqual(
      expect.arrayContaining(["importProducts", "importSites", "importLocations", "importSuppliers", "account"]),
    );
    expect(sections).not.toContain("importStock");
    expect(sections).not.toContain("users");

    const warehouse = paletteEntries(["Warehouse Staff"]).map((entry) => entry.section);
    expect(warehouse).toContain("importStock");
    expect(warehouse).not.toContain("importProducts");

    const admin = paletteEntries(["Platform Admin"]).map((entry) => entry.section);
    expect(admin).toContain("users");
    expect(admin).not.toContain("importProducts");
  });

  it("keeps the landing page by role instead of taking the first sidebar item", () => {
    expect(landingSection(["Pharmacist"])).toBe("pharmacistOverview");
    expect(landingSection(["Pharmacy Manager"])).toBe("dashboard");
    expect(landingSection(["Platform Admin"])).toBe("dashboard");
    expect(landingSection(["Warehouse Staff"])).toBe("dashboard");
  });

  it("normalises accents for page search", () => {
    expect(searchKey("Đơn thuốc")).toBe("don thuoc");
    expect(searchKey("Tồn kho")).toBe("ton kho");
  });

  it("filters page search on the translated labels the user sees", () => {
    const entries = paletteEntries(["Platform Admin"]);
    const translate = (key: string): string =>
      ({ System: "Hệ thống", Administration: "Quản trị" })[key as "System" | "Administration"] ?? key;
    expect(filterPaletteEntries(entries, "he thong", translate).map((entry) => entry.section)).toContain("system");
    expect(filterPaletteEntries(entries, "quan tri", translate).map((entry) => entry.section)).toContain("system");
  });
});
