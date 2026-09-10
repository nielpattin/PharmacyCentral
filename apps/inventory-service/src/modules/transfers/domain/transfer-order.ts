export type TransferStatus = "PendingApproval" | "Approved" | "InTransit" | "Received" | "Cancelled";

export const transitionTransfer = (
  current: TransferStatus,
  action: "approve" | "ship" | "receive" | "cancel",
): TransferStatus => {
  if (action === "approve" && current === "PendingApproval") return "Approved";
  if (action === "ship" && current === "Approved") return "InTransit";
  if (action === "receive" && current === "InTransit") return "Received";
  if (action === "cancel" && ["PendingApproval", "Approved"].includes(current)) return "Cancelled";
  throw new Error(`Invalid transfer transition: ${current} -> ${action}`);
};
