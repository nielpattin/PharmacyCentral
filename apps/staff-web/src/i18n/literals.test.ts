import { describe, expect, it } from "vitest";

import { adminLiterals } from "./admin.ts";
import { catalogLiterals } from "./catalog.ts";
import { commonLiterals } from "./common.ts";
import { governanceLiterals } from "./governance.ts";
import { inventoryLiterals } from "./inventory.ts";
import { procurementLiterals } from "./procurement.ts";
import { salesLiterals } from "./sales.ts";
import { shellLiterals } from "./shell.ts";

// Each area file is owned by one agent. A key defined in two areas would be silently overridden by the later spread
// in i18n.ts, so this test fails the build instead.
const areas: Record<string, Record<string, string>> = {
  shell: shellLiterals,
  admin: adminLiterals,
  catalog: catalogLiterals,
  inventory: inventoryLiterals,
  procurement: procurementLiterals,
  sales: salesLiterals,
  governance: governanceLiterals,
  common: commonLiterals,
};

describe("literal translation areas", () => {
  it("defines each English key in exactly one area", () => {
    const owners = new Map<string, string[]>();
    for (const [area, dictionary] of Object.entries(areas)) {
      for (const key of Object.keys(dictionary)) {
        owners.set(key, [...(owners.get(key) ?? []), area]);
      }
    }
    const duplicates = [...owners].filter(([, list]) => list.length > 1);
    expect(duplicates).toEqual([]);
  });

  it("keeps every value a non-empty string", () => {
    for (const dictionary of Object.values(areas)) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(typeof value, key).toBe("string");
        expect(value.trim(), key).not.toBe("");
      }
    }
  });
});
