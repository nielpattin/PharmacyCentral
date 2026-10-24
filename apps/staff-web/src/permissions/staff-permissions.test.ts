import { afterEach, describe, expect, it } from "vitest";

import { setLanguage, translateText } from "../i18n.ts";
import { can, staffActions, STAFF_ROLES, type StaffAction, type StaffRole } from "./staff-permissions.ts";

const PM = "Pharmacy Manager";
const PHARMACIST = "Pharmacist";
const WAREHOUSE = "Warehouse Staff";

// Who the authorizer admits for each action, without Platform Admin (it admits everyone; tested separately). Written
// from deploy/aws/lambda/policy.mjs, not read back from the map, so a wrong map entry fails here.
const admitted: Record<StaffAction, readonly StaffRole[]> = {
  "prescription.create": [PHARMACIST],
  "prescription.dispense": [PHARMACIST],
  "prescription.cancel": [PHARMACIST],
  "prescription.createInvoice": [PHARMACIST],
  "consultation.answer": [PHARMACIST],
  "payment.confirmCash": [PHARMACIST],
  "payment.refund": [PHARMACIST],
  "payment.invoices.view": [PHARMACIST, PM],
  "customer.lookup": [PHARMACIST],
  "finance.summary.view": [PM],
  "purchaseOrder.create": [PM],
  "purchaseOrder.approve": [PM],
  "purchaseOrder.cancel": [PM],
  "goodsReceipt.view": [WAREHOUSE],
  "goodsReceipt.create": [WAREHOUSE],
  "inventory.records.view": [WAREHOUSE],
  "inventory.batch.create": [WAREHOUSE],
  "inventory.batch.quality": [WAREHOUSE],
  "inventory.movement.create": [WAREHOUSE],
  "inventory.adjustment.create": [WAREHOUSE],
  "inventory.adjustment.decide": [WAREHOUSE],
  "inventory.transfer.create": [WAREHOUSE],
  "inventory.transfer.transition": [WAREHOUSE],
  "inventory.stocktake.create": [WAREHOUSE],
  "inventory.stocktake.count": [WAREHOUSE],
  "inventory.stocktake.post": [WAREHOUSE],
  "inventory.return.create": [WAREHOUSE],
  "replenishment.view": [PHARMACIST, WAREHOUSE],
  "replenishment.create": [PHARMACIST, WAREHOUSE],
  "replenishment.decide": [PHARMACIST, WAREHOUSE],
  "catalog.write": [PM],
  "catalog.import": [PM],
  "stock.import": [PHARMACIST, PM, WAREHOUSE, "Platform Admin"],
  "synonym.write": [PM],
  "synonym.approve": [PM],
  "governance.user.write": [],
  "ai.credential.write": [],
};

const sessionWith = (...roles: string[]) => ({ roles, userId: "user-1" });

describe("staff permission map", () => {
  afterEach(() => setLanguage("vi"));

  it.each(Object.keys(staffActions) as StaffAction[])("admits the roles the authorizer admits for %s", (action) => {
    for (const role of STAFF_ROLES.filter((candidate) => candidate !== "Platform Admin")) {
      const allowed = can(action, sessionWith(role)).allowed;
      expect(allowed, `${role} on ${action}`).toBe(admitted[action].includes(role));
    }
  });

  it.each(Object.keys(staffActions) as StaffAction[])("lets Platform Admin through %s", (action) => {
    expect(can(action, sessionWith("Platform Admin"))).toEqual({ allowed: true });
  });

  it("refuses every action to a session with no roles", () => {
    for (const action of Object.keys(staffActions) as StaffAction[]) {
      expect(can(action, { userId: "user-1" }).allowed, action).toBe(false);
    }
  });

  it("refuses a Platform Admin who approves their own search synonym group, as the server does", () => {
    const own = { ownerId: "user-1" };
    expect(can("synonym.approve", sessionWith("Platform Admin"), own)).toEqual({
      allowed: false,
      reason: "Bạn không thể duyệt thay đổi của chính mình",
    });
  });

  it("refuses a Pharmacy Manager who approves their own search synonym group", () => {
    expect(can("synonym.approve", sessionWith(PM), { ownerId: "user-1" }).allowed).toBe(false);
  });

  it("allows a Pharmacy Manager to approve a search synonym group someone else submitted", () => {
    expect(can("synonym.approve", sessionWith(PM), { ownerId: "user-2" })).toEqual({ allowed: true });
  });

  it("reports the role before the owner when both refuse", () => {
    const result = can("synonym.approve", sessionWith(PHARMACIST), { ownerId: "user-1" });
    expect(result).toEqual({ allowed: false, reason: "Chỉ Quản lý nhà thuốc được duyệt từ đồng nghĩa tìm kiếm." });
  });

  it("does not block a purchase order approval by its creator, because the server does not refuse it", () => {
    expect(can("purchaseOrder.approve", sessionWith(PM), { ownerId: "user-1" })).toEqual({ allowed: true });
  });

  it("returns a translated sentence for a refused role", () => {
    expect(can("purchaseOrder.approve", sessionWith(WAREHOUSE))).toEqual({
      allowed: false,
      reason: "Chỉ Quản lý nhà thuốc được duyệt đơn mua hàng.",
    });
  });

  it("returns the English sentence when the language is English", () => {
    setLanguage("en");
    expect(can("purchaseOrder.approve", sessionWith(WAREHOUSE))).toEqual({
      allowed: false,
      reason: "Only a Pharmacy Manager can approve purchase orders.",
    });
  });

  it("has a Vietnamese translation for every rule reason", () => {
    for (const [action, rule] of Object.entries(staffActions)) {
      expect(translateText(rule.reason), action).not.toBe(rule.reason);
    }
  });
});
