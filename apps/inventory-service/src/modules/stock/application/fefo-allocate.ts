export type FefoBalance = {
  productBatchId: string;
  storageLocationId: string;
  expiryDate: string;
  batchNumber: string;
  quantityOnHand: number;
  quantityReserved: number;
};

export type FefoAllocation = {
  productBatchId: string;
  storageLocationId: string;
  quantity: number;
};

/** The sellable stock cannot cover the quantity asked for. */
export class InsufficientStockError extends Error {
  public constructor() {
    super("Insufficient stock");
  }
}

export const allocateFefo = (balances: FefoBalance[], quantityNeeded: number): FefoAllocation[] => {
  if (!(quantityNeeded > 0)) {
    throw new Error("Quantity needed must be positive");
  }

  const ordered = balances
    .filter((balance) => balance.quantityOnHand - balance.quantityReserved > 0)
    .toSorted(
      (left, right) =>
        left.expiryDate.localeCompare(right.expiryDate) ||
        left.batchNumber.localeCompare(right.batchNumber) ||
        left.storageLocationId.localeCompare(right.storageLocationId),
    );
  const available = ordered.reduce((total, balance) => total + balance.quantityOnHand - balance.quantityReserved, 0);
  if (available < quantityNeeded) {
    throw new InsufficientStockError();
  }

  let remaining = quantityNeeded;
  const allocations: FefoAllocation[] = [];
  for (const balance of ordered) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, balance.quantityOnHand - balance.quantityReserved);
    allocations.push({
      productBatchId: balance.productBatchId,
      storageLocationId: balance.storageLocationId,
      quantity,
    });
    remaining -= quantity;
  }
  return allocations;
};
