import { useSyncExternalStore } from "react";

export type SessionSnapshot = {
  authenticated: boolean;
  userId?: string;
};

const emptySnapshot: SessionSnapshot = { authenticated: false };
let snapshot = emptySnapshot;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setSessionSnapshot = (nextSnapshot: SessionSnapshot): void => {
  snapshot = nextSnapshot;
  for (const listener of listeners) {
    listener();
  }
};

export const useSession = (): SessionSnapshot =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => emptySnapshot,
  );
