/** What identity answers when it starts a session. The rest of the body is the account profile. */
export type AccessGrant = { accessToken: string; accessTokenExpiresAt: string };

export type AccessTokenStore = {
  /** Keeps the grant a sign-in or password change answered with. */
  set: (grant: AccessGrant) => void;
  /** Forgets the token: this is how the browser signs out. */
  clear: () => void;
  /** The token to send, or `undefined` when the browser holds none or the one it holds has expired. */
  current: () => string | undefined;
  /**
   * Reads the `#access_token=` fragment the Google callback redirects with, stores the token and strips the fragment
   * from the address bar. Answers whether a token was taken from the URL; later calls find no fragment.
   */
  adoptUrlFragment: () => boolean;
};

/** The localStorage key holding `{ token, expiresAt }`. */
export const ACCESS_TOKEN_STORAGE_KEY = "pharmacy_access_token";

type StoredToken = { token: string; expiresAt: number };

const FRAGMENT_PARAMETER = "access_token";

const storage = (): Storage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

const isStoredToken = (value: unknown): value is StoredToken =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as StoredToken).token === "string" &&
  (value as StoredToken).token.length > 0 &&
  typeof (value as StoredToken).expiresAt === "number" &&
  Number.isFinite((value as StoredToken).expiresAt);

const readStored = (): StoredToken | undefined => {
  const raw = storage()?.getItem(ACCESS_TOKEN_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredToken(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** The `exp` claim of a JWT in milliseconds, or `undefined` when the token carries none. */
const expiryOf = (token: string): number | undefined => {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
};

/** Holds the one access token the browser sends to every service. It lives in localStorage until it expires. */
export const createAccessTokenStore = (): AccessTokenStore => {
  const clear = (): void => {
    storage()?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  };

  const keep = (token: string, expiresAt: number): void => {
    storage()?.setItem(ACCESS_TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt } satisfies StoredToken));
  };

  return {
    set: (grant) => {
      const expiresAt = new Date(grant.accessTokenExpiresAt).getTime();
      if (Number.isNaN(expiresAt)) {
        clear();
        return;
      }
      keep(grant.accessToken, expiresAt);
    },
    clear,
    current: () => {
      const stored = readStored();
      if (!stored) return undefined;
      if (stored.expiresAt <= Date.now()) {
        clear();
        return undefined;
      }
      return stored.token;
    },
    adoptUrlFragment: () => {
      if (typeof window === "undefined") return false;
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = fragment.get(FRAGMENT_PARAMETER);
      if (token === null) return false;
      fragment.delete(FRAGMENT_PARAMETER);
      const rest = fragment.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ""}`,
      );
      const expiresAt = expiryOf(token);
      if (token === "" || expiresAt === undefined || expiresAt <= Date.now()) return false;
      keep(token, expiresAt);
      return true;
    },
  };
};
