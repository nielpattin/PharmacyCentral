import { describe, expect, it } from "vitest";

import { INVENTORY_GROUPS, INVENTORY_TABS, visibleGroups } from "./tabs.ts";

describe("inventory tab groups", () => {
  it("places every tab in exactly one group", () => {
    const grouped = INVENTORY_GROUPS.flatMap((group) => group.tabs);
    expect([...grouped].sort()).toEqual([...INVENTORY_TABS].sort());
  });

  it("drops the tabs a role cannot see and the groups left empty", () => {
    expect(visibleGroups(["Balances", "Replenishment"])).toEqual([
      { id: "Stock", tabs: ["Balances"] },
      { id: "Supply", tabs: ["Replenishment"] },
    ]);
  });
});
