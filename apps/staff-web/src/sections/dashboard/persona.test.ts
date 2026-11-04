import { describe, expect, it } from "vitest";

import { dashboardPersona } from "./persona.ts";

describe("dashboardPersona", () => {
  it("gives each role its own dashboard", () => {
    expect(dashboardPersona(["Pharmacy Manager"])).toBe("manager");
    expect(dashboardPersona(["Warehouse Staff"])).toBe("warehouse");
    expect(dashboardPersona(["Platform Admin"])).toBe("admin");
  });

  it("lets a working role win over Platform Admin", () => {
    expect(dashboardPersona(["Platform Admin", "Warehouse Staff"])).toBe("warehouse");
    expect(dashboardPersona(["Platform Admin", "Pharmacy Manager"])).toBe("manager");
  });

  it("has no dashboard for the Pharmacist or an empty role set", () => {
    expect(dashboardPersona(["Pharmacist"])).toBeUndefined();
    expect(dashboardPersona([])).toBeUndefined();
  });
});
