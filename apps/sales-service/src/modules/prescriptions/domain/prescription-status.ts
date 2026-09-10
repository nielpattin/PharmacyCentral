export type PrescriptionStatus = "Draft" | "Pending" | "PartiallyDispensed" | "Dispensed" | "Cancelled";

const transitions: Record<PrescriptionStatus, readonly PrescriptionStatus[]> = {
  Draft: ["Pending", "Cancelled"],
  Pending: ["PartiallyDispensed", "Dispensed", "Cancelled"],
  PartiallyDispensed: ["Dispensed", "Cancelled"],
  Dispensed: [],
  Cancelled: [],
};

export const transitionPrescription = (current: PrescriptionStatus, next: PrescriptionStatus): PrescriptionStatus => {
  if (!transitions[current].includes(next)) throw new Error(`Invalid prescription transition: ${current} -> ${next}`);
  return next;
};
