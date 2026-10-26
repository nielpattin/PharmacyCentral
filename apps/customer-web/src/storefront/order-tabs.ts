/** The two views of the order page: placing a new order, and following the ones already placed. */
export const ORDER_TABS = ["dat-hang", "don-cua-toi"] as const;
export type OrderTab = (typeof ORDER_TABS)[number];
