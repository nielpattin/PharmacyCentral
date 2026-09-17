import { useSyncExternalStore } from "react";

import type { Cart } from "../customer-api.ts";

const emptySnapshot: Cart = { id: "", lines: [] };

let snapshot: Cart = emptySnapshot;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setCartSnapshot = (nextSnapshot: Cart | undefined): void => {
  snapshot = nextSnapshot ?? emptySnapshot;
  for (const listener of listeners) {
    listener();
  }
};

export const useCart = (): Cart =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => emptySnapshot,
  );

export const useCartLineCount = (): number => {
  const cart = useCart();
  return cart.lines.reduce((total, line) => total + Number(line.quantity), 0);
};
