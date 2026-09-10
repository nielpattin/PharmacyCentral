export type ReplenishmentStatus = "Pending" | "Approved" | "Rejected" | "Cancelled" | "Fulfilled";

export const transitionReplenishment = (
  current: ReplenishmentStatus,
  action: "approve" | "reject" | "cancel" | "fulfill",
): ReplenishmentStatus => {
  if (current === "Pending" && action === "approve") return "Approved";
  if (current === "Pending" && action === "reject") return "Rejected";
  if (["Pending", "Approved"].includes(current) && action === "cancel") return "Cancelled";
  if (current === "Approved" && action === "fulfill") return "Fulfilled";
  throw new Error(`Invalid replenishment transition: ${current} -> ${action}`);
};
