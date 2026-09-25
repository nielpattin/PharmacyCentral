import { useSyncExternalStore } from "react";

export type SessionSnapshot = {
  authenticated: boolean;
  /** False until a probe confirms the session, so the UI never guesses "signed out" before it knows. */
  resolved: boolean;
  userId?: string;
};

const emptySnapshot: SessionSnapshot = { authenticated: false, resolved: false };
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
