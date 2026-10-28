import { describe, expect, it } from "vitest";

import { tabGate } from "../../permissions/staff-permissions.ts";
import { PROCUREMENT_CREATE, PROCUREMENT_TAB_ACTIONS, PROCUREMENT_TABS, toProcurementTab } from "./tabs.ts";

describe("procurement tabs", () => {
  it("lists reorder suggestions after goods receipts", () => {
    expect(PROCUREMENT_TABS).toEqual(["Purchase orders", "Goods receipts", "Reorder suggestions"]);
  });

  it("reads the reorder tab from the URL and falls back to the page default otherwise", () => {
    expect(toProcurementTab("Reorder suggestions", "Purchase orders")).toBe("Reorder suggestions");
    expect(toProcurementTab("Unknown tab", "Purchase orders")).toBe("Purchase orders");
    expect(toProcurementTab("", "Goods receipts")).toBe("Goods receipts");
  });

  it("opens the reorder tab for Platform Admin and Pharmacy Manager only", () => {
    const action = PROCUREMENT_TAB_ACTIONS["Reorder suggestions"];
    expect(tabGate(action, { roles: ["Platform Admin"] }).allowed).toBe(true);
    expect(tabGate(action, { roles: ["Pharmacy Manager"] }).allowed).toBe(true);
    expect(tabGate(action, { roles: ["Pharmacist"] }).allowed).toBe(false);
    expect(tabGate(action, { roles: ["Warehouse Staff"] }).allowed).toBe(false);
    expect(tabGate(action, { roles: [] }).allowed).toBe(false);
  });

  it("keeps the header create button off the reorder tab, since its drafts are made from its own table", () => {
    expect(PROCUREMENT_CREATE["Reorder suggestions"]).toBeUndefined();
  });

  it("keeps the existing tabs' gates", () => {
    expect(tabGate(PROCUREMENT_TAB_ACTIONS["Purchase orders"], { roles: ["Pharmacist"] }).allowed).toBe(true);
    expect(tabGate(PROCUREMENT_TAB_ACTIONS["Goods receipts"], { roles: ["Warehouse Staff"] }).allowed).toBe(true);
    expect(tabGate(PROCUREMENT_TAB_ACTIONS["Goods receipts"], { roles: ["Pharmacy Manager"] }).allowed).toBe(false);
  });
});
