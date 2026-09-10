export type CountSheet = {
  systemQuantity: number;
  countedQuantity?: number;
  status: "Pending" | "Counted" | "Approved";
};

export const calculateVariance = (line: Pick<CountSheet, "systemQuantity" | "countedQuantity">): number => {
  if (line.countedQuantity === undefined) {
    throw new Error("Counted quantity is required");
  }
  return line.countedQuantity - line.systemQuantity;
};

export const approveCount = (line: CountSheet): CountSheet => {
  if (line.status !== "Counted" || line.countedQuantity === undefined) {
    throw new Error("Only counted lines can be approved");
  }
  return { ...line, status: "Approved" };
};
