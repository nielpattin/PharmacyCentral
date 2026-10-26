import { useSyncExternalStore } from "react";

export type SessionSnapshot = {
  authenticated: boolean;
  /** False until a probe confirms the session, so the UI never guesses "signed out" before it knows. */
  resolved: boolean;
  userId?: string;
  /** Set when a 401 ended the session, so the sign-in dialog says why it opened (auth.sessionExpired). */
  sessionEndedNotice?: string;
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

/** The session as it is now, for callers outside React (the 401 listener) that must not act on a stale render. */
export const currentSession = (): SessionSnapshot => snapshot;

export const useSession = (): SessionSnapshot =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => emptySnapshot,
  );
