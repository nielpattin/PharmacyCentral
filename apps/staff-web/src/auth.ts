import { useSyncExternalStore } from "react";

export type SessionSnapshot = {
  authenticated: boolean;
  userId?: string;
  /** The employee's name, from `/api/auth/me` and `/api/auth/login`. */
  displayName?: string;
  roles?: string[];
  /** The sites the employee is assigned to, from `/api/auth/me`. */
  siteIds?: string[];
  /** The employee must change the password before any section opens (identity gate). */
  passwordChangeRequired?: boolean;
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

/** The session as it is now, for callers outside React (the 401 listener) that must not act on a stale render. */
export const currentSession = (): SessionSnapshot => snapshot;

export const useSession = (): SessionSnapshot =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => emptySnapshot,
  );

/**
 * The English text of the `auth.sessionExpired` key. The sign-in card shows it through `translateText`, which maps the
 * English value back to that key's Vietnamese text.
 */
export const SESSION_EXPIRED_MESSAGE = "Session expired. Please sign in again.";

/** Refused at the staff sign-in: a customer account. Shown through `translateText` (shell literals). */
export const EMPLOYEE_ACCOUNT_REQUIRED = "Employee account required";

/** Refused at the staff sign-in: an employee with no role. Shown through `translateText` (shell literals). */
export const NO_ROLE_ASSIGNED = "This account has no role assigned. Contact an administrator.";

/**
 * Why a signed-in account may not use staff-web, or `undefined` when it may. A refused account keeps no session.
 * Identity answers a customer 403 at the login itself (`audience: "employee"`), so the probe path is the only one that
 * can see one here.
 */
export const staffAccessRefusal = (account: {
  actorType: "employee" | "customer";
  roles: readonly string[];
}): string | undefined => {
  if (account.actorType !== "employee") return EMPLOYEE_ACCOUNT_REQUIRED;
  if (account.roles.length === 0) return NO_ROLE_ASSIGNED;
  return undefined;
};
