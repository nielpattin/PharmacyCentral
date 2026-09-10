export type StockQuantity = {
  quantityOnHand: number;
  quantityReserved: number;
};

export const availableQuantity = (quantity: StockQuantity): number =>
  quantity.quantityOnHand - quantity.quantityReserved;

export const applyMovement = (quantity: StockQuantity, quantityDelta: number): StockQuantity => {
  if (quantityDelta === 0) {
    throw new Error("Stock movement cannot be zero");
  }

  const next: StockQuantity = {
    quantityOnHand: quantity.quantityOnHand + quantityDelta,
    quantityReserved: quantity.quantityReserved,
  };
  if (next.quantityOnHand < 0) {
    throw new Error("Quantity on hand cannot be negative");
  }
  if (next.quantityOnHand < next.quantityReserved) {
    throw new Error("Quantity on hand cannot be less than reserved quantity");
  }
  return next;
};

export const reserveQuantity = (quantity: StockQuantity, amount: number): StockQuantity => {
  if (!(amount > 0) || amount > availableQuantity(quantity)) {
    throw new Error("Insufficient available quantity");
  }
  return { ...quantity, quantityReserved: quantity.quantityReserved + amount };
};

export const releaseQuantity = (quantity: StockQuantity, amount: number): StockQuantity => {
  if (!(amount >= 0) || amount > quantity.quantityReserved) {
    throw new Error("Reserved quantity release is invalid");
  }
  return { ...quantity, quantityReserved: quantity.quantityReserved - amount };
};
