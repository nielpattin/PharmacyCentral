import { afterEach, describe, expect, it } from "vitest";

import { setLanguage, translateText } from "../i18n.ts";
import {
  can,
  canAtSite,
  canChangeActionPlanStatus,
  canReassignActionPlan,
  staffActions,
  STAFF_ROLES,
  type StaffAction,
  type StaffRole,
} from "./staff-permissions.ts";

const PA = "Platform Admin";
const PM = "Pharmacy Manager";
const PHARMACIST = "Pharmacist";
const WAREHOUSE = "Warehouse Staff";

// Who the role contract admits for each action, without Platform Admin (listed separately below). Written from the inventory and
// shell specs and deploy/aws/lambda/policy.mjs, not read back from the map, so a wrong map entry fails here.
const admitted: Record<StaffAction, readonly StaffRole[]> = {
  "prescription.create": [PHARMACIST],
  "prescription.dispense": [PHARMACIST],
  "prescription.cancel": [PHARMACIST],
  "prescription.createInvoice": [PHARMACIST],
  "consultation.answer": [PHARMACIST],
  "order.transition": [PHARMACIST, PM],
  "payment.confirmCash": [PHARMACIST],
  "payment.refund.counter": [PHARMACIST],
  "payment.refund": [PM],
  "payment.invoices.view": [PHARMACIST, PM],
  "customer.lookup": [PHARMACIST],
  "finance.summary.view": [PM],
  "purchaseOrder.create": [PM],
  "purchaseOrder.approve": [PM],
  "purchaseOrder.cancel": [PM],
  "price.publish": [PM],
  "replenishment.suggestions.view": [PM],
  "goodsReceipt.view": [WAREHOUSE],
  "goodsReceipt.create": [WAREHOUSE],
  "inventory.balances.view": [PHARMACIST, PM, WAREHOUSE],
  "inventory.batches.view": [PHARMACIST, PM, WAREHOUSE],
  "inventory.movements.view": [PM, WAREHOUSE],
  "inventory.adjustments.view": [PM, WAREHOUSE],
  "inventory.disposals.view": [PHARMACIST, PM, WAREHOUSE],
  "inventory.transfers.view": [PM, WAREHOUSE],
  "inventory.stocktake.view": [PM, WAREHOUSE],
  "inventory.returns.view": [PM, WAREHOUSE],
  "inventory.batch.create": [WAREHOUSE],
  "inventory.batch.quality": [PHARMACIST, PM],
  "inventory.movement.create": [WAREHOUSE],
  "inventory.adjustment.create": [WAREHOUSE],
  "inventory.adjustment.decide": [PM],
  "inventory.disposal.create": [PHARMACIST, WAREHOUSE],
  "inventory.disposal.decide": [PM],
  "inventory.transfer.create": [WAREHOUSE],
  "inventory.transfer.approve": [PM],
  "inventory.transfer.transition": [WAREHOUSE],
  "inventory.transfer.cancel": [PM],
  "inventory.stocktake.create": [WAREHOUSE],
  "inventory.stocktake.count": [WAREHOUSE],
  "inventory.stocktake.post": [PM],
  "inventory.return.create": [WAREHOUSE],
  "replenishment.view": [PHARMACIST, PM, WAREHOUSE],
  "replenishment.create": [PHARMACIST, PM],
  "replenishment.decide": [WAREHOUSE],
  "replenishment.cancel": [WAREHOUSE],
  "actionPlan.create": [PM],
  "salesTarget.set": [PM],
  "actionPlan.reassign": [PM],
  "catalog.write": [PM],
  "catalog.site.create": [],
  "catalog.site.delete": [],
  "catalog.import": [PM],
  "stock.import": [WAREHOUSE],
  "synonym.write": [PHARMACIST, PM],
  "synonym.approve": [PHARMACIST, PM],
  "governance.user.write": [],
  "ai.credential.write": [],
};

// What Platform Admin may do: read the operational screens, and write only users, site create and delete, AI
// credentials and the owner of an action plan. Everything else belongs to the three working roles.
const platformAdminActions: readonly StaffAction[] = [
  "payment.invoices.view",
  "finance.summary.view",
  "replenishment.suggestions.view",
  "goodsReceipt.view",
  "inventory.balances.view",
  "inventory.batches.view",
  "inventory.movements.view",
  "inventory.adjustments.view",
  "inventory.disposals.view",
  "inventory.transfers.view",
  "inventory.stocktake.view",
  "inventory.returns.view",
  "replenishment.view",
  "actionPlan.reassign",
  "catalog.site.create",
  "catalog.site.delete",
  "governance.user.write",
  "ai.credential.write",
];

const sessionWith = (...roles: string[]) => ({ roles, userId: "user-1" });
const ownedBy = (ownerId: string) => ({ ownerId });

describe("staff permission map", () => {
  afterEach(() => setLanguage("vi"));

  it.each(Object.keys(staffActions) as StaffAction[])("admits the roles the contract admits for %s", (action) => {
    for (const role of STAFF_ROLES.filter((candidate) => candidate !== PA)) {
      const allowed = can(action, sessionWith(role)).allowed;
      expect(allowed, `${role} on ${action}`).toBe(admitted[action].includes(role));
    }
  });

  it.each(Object.keys(staffActions) as StaffAction[])(
    "admits Platform Admin to %s only when it reads or administers",
    (action) => {
      const result = can(action, sessionWith(PA));
      expect(result.allowed, action).toBe(platformAdminActions.includes(action));
    },
  );

  it("refuses every action to a session with no roles", () => {
    for (const action of Object.keys(staffActions) as StaffAction[]) {
      expect(can(action, { userId: "user-1" }).allowed, action).toBe(false);
    }
  });

  it("refuses a Platform Admin the counter and cash actions with a Pharmacist reason", () => {
    expect(can("payment.confirmCash", sessionWith(PA))).toEqual({
      allowed: false,
      reason: "Chỉ Dược sĩ được xác nhận thanh toán tiền mặt.",
    });
  });
});

describe("separation of duties", () => {
  it.each<[StaffAction, StaffRole]>([
    ["synonym.approve", PM],
    ["purchaseOrder.approve", PM],
    ["inventory.adjustment.decide", PM],
    ["inventory.transfer.approve", PM],
    ["inventory.stocktake.post", PM],
    ["replenishment.decide", WAREHOUSE],
  ])("refuses %s to the creator of the record (%s)", (action, role) => {
    expect(can(action, { roles: [role], userId: "user-1" }, ownedBy("user-1")).allowed).toBe(false);
  });

  it.each<[StaffAction, StaffRole]>([
    ["synonym.approve", PM],
    ["purchaseOrder.approve", PM],
    ["inventory.adjustment.decide", PM],
    ["inventory.transfer.approve", PM],
    ["inventory.stocktake.post", PM],
    ["replenishment.decide", WAREHOUSE],
  ])("allows %s to another person of the same role (%s)", (action, role) => {
    expect(can(action, { roles: [role], userId: "user-1" }, ownedBy("user-2"))).toEqual({ allowed: true });
  });

  it("refuses a Platform Admin the decision on an adjustment, which a Pharmacy Manager makes", () => {
    expect(can("inventory.adjustment.decide", sessionWith(PA), ownedBy("user-2")).allowed).toBe(false);
  });

  it("refuses a Pharmacy Manager who approves their own search synonym group", () => {
    expect(can("synonym.approve", sessionWith(PM), ownedBy("user-1")).allowed).toBe(false);
  });

  it("allows a Pharmacist to approve a search synonym group someone else submitted", () => {
    expect(can("synonym.approve", sessionWith(PHARMACIST), ownedBy("user-2"))).toEqual({ allowed: true });
  });

  it("refuses a Platform Admin the search synonym approval whoever submitted it", () => {
    expect(can("synonym.approve", sessionWith(PA), ownedBy("user-2"))).toEqual({
      allowed: false,
      reason: "Chỉ Dược sĩ hoặc Quản lý nhà thuốc được duyệt từ đồng nghĩa tìm kiếm.",
    });
  });

  it("reports the role before the owner when both refuse", () => {
    const result = can("synonym.approve", sessionWith(WAREHOUSE), ownedBy("user-1"));
    expect(result).toEqual({
      allowed: false,
      reason: "Chỉ Dược sĩ hoặc Quản lý nhà thuốc được duyệt từ đồng nghĩa tìm kiếm.",
    });
  });

  it("refuses a Warehouse Staff member the approval of a transfer, whoever created it", () => {
    expect(can("inventory.transfer.approve", sessionWith(WAREHOUSE), ownedBy("user-2")).allowed).toBe(false);
  });

  it("lets the creator of a transfer cancel it, as Warehouse Staff", () => {
    expect(can("inventory.transfer.cancel", sessionWith(WAREHOUSE), ownedBy("user-1"))).toEqual({ allowed: true });
  });

  it("refuses another Warehouse Staff member the cancellation of a transfer", () => {
    expect(can("inventory.transfer.cancel", sessionWith(WAREHOUSE), ownedBy("user-2")).allowed).toBe(false);
  });

  it("lets a Pharmacy Manager cancel any transfer", () => {
    expect(can("inventory.transfer.cancel", sessionWith(PM), ownedBy("user-2"))).toEqual({ allowed: true });
  });

  it("lets a Pharmacist cancel their own replenishment request only", () => {
    expect(can("replenishment.cancel", sessionWith(PHARMACIST), ownedBy("user-1"))).toEqual({ allowed: true });
    expect(can("replenishment.cancel", sessionWith(PHARMACIST), ownedBy("user-2")).allowed).toBe(false);
  });

  it("lets Warehouse Staff cancel a replenishment request made by someone else", () => {
    expect(can("replenishment.cancel", sessionWith(WAREHOUSE), ownedBy("user-2"))).toEqual({ allowed: true });
  });

  it("refuses a Pharmacist a replenishment cancellation when the record has no owner", () => {
    expect(can("replenishment.cancel", sessionWith(PHARMACIST)).allowed).toBe(false);
  });

  it("allows a Pharmacy Manager to approve a purchase order someone else created", () => {
    expect(can("purchaseOrder.approve", sessionWith(PM), ownedBy("user-2"))).toEqual({ allowed: true });
  });

  it("refuses the creator of a price draft its publish, with the catalog's own reason", () => {
    expect(can("price.publish", sessionWith(PM), ownedBy("user-1"))).toEqual({
      allowed: false,
      reason: "Người tạo bản nháp không được phát hành bản nháp đó.",
    });
  });

  it("allows a Pharmacy Manager to publish a price draft someone else created", () => {
    expect(can("price.publish", sessionWith(PM), ownedBy("user-2"))).toEqual({ allowed: true });
  });
});

describe("site scope", () => {
  const manager = { roles: [PM], userId: "user-1", siteIds: ["site-a"] };

  it("allows a manager a write at an assigned site", () => {
    expect(canAtSite("catalog.write", manager, "site-a")).toEqual({ allowed: true });
  });

  it("refuses a manager a write at a site they are not assigned", () => {
    expect(canAtSite("catalog.write", manager, "site-b")).toEqual({
      allowed: false,
      reason: "Chỉ sửa được bản ghi thuộc cơ sở được gán cho bạn.",
    });
  });

  it("refuses a manager a write on a record with no site", () => {
    expect(canAtSite("catalog.write", manager, undefined).allowed).toBe(false);
  });

  it("gives Platform Admin every site, with no assignment", () => {
    expect(canAtSite("actionPlan.reassign", { roles: [PA], userId: "user-1" }, "site-z")).toEqual({ allowed: true });
  });

  it("reports the role before the site when the role is refused", () => {
    expect(canAtSite("catalog.write", { roles: [WAREHOUSE], userId: "u", siteIds: ["site-a"] }, "site-a")).toEqual({
      allowed: false,
      reason: "Chỉ Quản lý nhà thuốc được thay đổi danh mục và dữ liệu nền.",
    });
  });
});

describe("action plan access", () => {
  const plan = { ownerId: "owner-1", siteId: "site-a" };
  const manager = { roles: [PM], userId: "manager-1", siteIds: ["site-a"] };
  const owner = { roles: [PHARMACIST], userId: "owner-1", siteIds: ["site-a"] };
  const otherPharmacist = { roles: [PHARMACIST], userId: "user-9", siteIds: ["site-a"] };

  it("lets a manager reassign a plan at their site", () => {
    expect(canReassignActionPlan(manager, plan)).toEqual({ allowed: true });
  });

  it("refuses the plan's owner the reassignment, since the owner works the status only", () => {
    expect(canReassignActionPlan(owner, plan).allowed).toBe(false);
  });

  it("refuses a manager the reassignment of a plan at a site they are not assigned", () => {
    expect(canReassignActionPlan(manager, { ownerId: "owner-1", siteId: "site-b" }).allowed).toBe(false);
  });

  it("refuses a manager the reassignment of a plan with no site, and lets Platform Admin reassign it", () => {
    expect(canReassignActionPlan(manager, { ownerId: "owner-1", siteId: null }).allowed).toBe(false);
    expect(canReassignActionPlan({ roles: [PA], userId: "admin" }, { ownerId: "owner-1", siteId: null })).toEqual({
      allowed: true,
    });
  });

  it("lets the plan's owner change its status, whatever the site", () => {
    expect(canChangeActionPlanStatus(owner, { ownerId: "owner-1", siteId: "site-z" })).toEqual({ allowed: true });
  });

  it("refuses a manager the status change of a plan they do not own", () => {
    expect(canChangeActionPlanStatus(manager, plan)).toEqual({
      allowed: false,
      reason: translateText("Only the plan's owner can change its status."),
    });
  });

  it("lets a manager who owns the plan change its status", () => {
    expect(canChangeActionPlanStatus(manager, { ownerId: "manager-1", siteId: "site-a" })).toEqual({ allowed: true });
  });

  it("refuses another pharmacist, and a session with no user id, the status change", () => {
    expect(canChangeActionPlanStatus(otherPharmacist, plan).allowed).toBe(false);
    expect(canChangeActionPlanStatus({ roles: [PHARMACIST] }, plan).allowed).toBe(false);
  });
});

describe("staff permission texts", () => {
  afterEach(() => setLanguage("vi"));

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
