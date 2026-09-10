export type BatchQualityStatus = "PendingQc" | "Released" | "Rejected";

export const reviewBatchQuality = (
  current: BatchQualityStatus,
  decision: "release" | "reject",
  hasPositiveStock: boolean,
): BatchQualityStatus => {
  if (!hasPositiveStock) {
    throw new Error("Batch must have positive stock before quality review");
  }
  if (current !== "PendingQc" && current !== "Rejected") {
    throw new Error("Batch cannot be reviewed in its current state");
  }
  return decision === "release" ? "Released" : "Rejected";
};
