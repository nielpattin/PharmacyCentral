import { describe, expect, it } from "vitest";

import { masterDataConfigs, sameValues } from "./master-data-config.ts";

describe("master data request bodies", () => {
  it("sends empty optional text as null and blank coordinates as null", () => {
    const body = masterDataConfigs.sites.toBody({
      ...masterDataConfigs.sites.initialValues(),
      code: "SITE-9",
      name: "Branch nine",
      address: "   ",
      notes: "",
      latitude: "",
      longitude: "106.7",
    });

    expect(body).toMatchObject({
      code: "SITE-9",
      address: null,
      notes: null,
      latitude: null,
      longitude: 106.7,
      isActive: true,
      isCustomerFacing: true,
    });
  });

  it("turns the boolean selects into booleans", () => {
    const body = masterDataConfigs.suppliers.toBody({
      ...masterDataConfigs.suppliers.initialValues(),
      code: "SUP-9",
      name: "Supplier nine",
      email: " buyer@example.com ",
      isActive: "false",
    });

    expect(body).toMatchObject({ email: "buyer@example.com", isActive: false, contactName: null });
  });

  it("sends the location capacity as a number or null", () => {
    const config = masterDataConfigs.locations;
    expect(
      config.toBody({ ...config.initialValues(), siteId: "s1", code: "A", name: "A", capacity: "12" }),
    ).toMatchObject({ siteId: "s1", capacity: 12, isActive: true });
    expect(config.toBody({ ...config.initialValues(), capacity: "" })).toMatchObject({ capacity: null });
  });

  it("reads a stored row back into form values that round-trip to the same body", () => {
    const row = {
      id: "3f2c",
      code: "HQ-MAIN",
      name: "Main",
      siteId: "site-1",
      locationType: "Warehouse",
      status: "Active",
      capacity: 40,
      isActive: false,
    };
    const config = masterDataConfigs.locations;
    const values = config.valuesFromRow(row);

    expect(values).toMatchObject({ capacity: "40", isActive: "false", siteId: "site-1" });
    expect(config.toBody(values)).toMatchObject({ capacity: 40, isActive: false, code: "HQ-MAIN" });
    expect(config.codeOf(row)).toBe("HQ-MAIN");
  });
});

describe("sameValues", () => {
  it("compares every key of both sides", () => {
    expect(sameValues({ a: "1", b: "" }, { a: "1", b: "" })).toBe(true);
    expect(sameValues({ a: "1" }, { a: "2" })).toBe(false);
    expect(sameValues({ a: "1" }, { a: "1", b: "x" })).toBe(false);
  });
});
