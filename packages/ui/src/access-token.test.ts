import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACCESS_TOKEN_STORAGE_KEY, createAccessTokenStore } from "./access-token.ts";

const grantAt = (token: string, expiresInMs: number) => ({
  accessToken: token,
  accessTokenExpiresAt: new Date(Date.now() + expiresInMs).toISOString(),
});

const jwtExpiring = (expiresInMs: number): string => {
  const encode = (value: object): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode({ alg: "ES256" })}.${encode({ exp: Math.floor((Date.now() + expiresInMs) / 1000) })}.signature`;
};

let items: Map<string, string>;

beforeEach(() => {
  items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string): string | null => items.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      items.set(key, value);
    },
    removeItem: (key: string): void => {
      items.delete(key);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("access token store", () => {
  it("answers no token while the browser holds none", () => {
    expect(createAccessTokenStore().current()).toBeUndefined();
  });

  it("keeps a grant in localStorage as { token, expiresAt } and reads it back in a new store", () => {
    const grant = grantAt("kept", 120_000);
    createAccessTokenStore().set(grant);
    expect(JSON.parse(items.get(ACCESS_TOKEN_STORAGE_KEY) ?? "null")).toEqual({
      token: "kept",
      expiresAt: new Date(grant.accessTokenExpiresAt).getTime(),
    });
    expect(createAccessTokenStore().current()).toBe("kept");
  });

  it("answers no token, and forgets it, once the token has expired", () => {
    const store = createAccessTokenStore();
    store.set(grantAt("old", -1_000));
    expect(store.current()).toBeUndefined();
    expect(items.has(ACCESS_TOKEN_STORAGE_KEY)).toBe(false);
  });

  it("ignores a stored value that is not a token record", () => {
    items.set(ACCESS_TOKEN_STORAGE_KEY, "not json");
    expect(createAccessTokenStore().current()).toBeUndefined();
    items.set(ACCESS_TOKEN_STORAGE_KEY, JSON.stringify({ token: 1 }));
    expect(createAccessTokenStore().current()).toBeUndefined();
  });

  it("forgets the token on clear", () => {
    const store = createAccessTokenStore();
    store.set(grantAt("fresh", 120_000));
    store.clear();
    expect(store.current()).toBeUndefined();
    expect(items.has(ACCESS_TOKEN_STORAGE_KEY)).toBe(false);
  });
});

describe("Google callback fragment", () => {
  let location: { pathname: string; search: string; hash: string };
  let replaceState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    location = { pathname: "/tai-khoan", search: "?section=ho-so", hash: "" };
    replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
      const hashAt = url.indexOf("#");
      location.hash = hashAt === -1 ? "" : url.slice(hashAt);
    });
    vi.stubGlobal("window", { location, history: { state: null, replaceState } });
  });

  it("stores the token once and strips the fragment from the URL", () => {
    const token = jwtExpiring(3_600_000);
    location.hash = `#access_token=${token}`;
    const store = createAccessTokenStore();

    expect(store.adoptUrlFragment()).toBe(true);
    expect(store.current()).toBe(token);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/tai-khoan?section=ho-so");
    expect(location.hash).toBe("");
    expect(store.adoptUrlFragment()).toBe(false);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("keeps other fragment parameters", () => {
    location.hash = `#access_token=${jwtExpiring(3_600_000)}&tab=orders`;
    createAccessTokenStore().adoptUrlFragment();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/tai-khoan?section=ho-so#tab=orders");
  });

  it("strips but does not store an expired or unreadable token", () => {
    const store = createAccessTokenStore();
    location.hash = `#access_token=${jwtExpiring(-60_000)}`;
    expect(store.adoptUrlFragment()).toBe(false);
    location.hash = "#access_token=garbage";
    expect(store.adoptUrlFragment()).toBe(false);
    expect(store.current()).toBeUndefined();
    expect(replaceState).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the URL carries no token", () => {
    expect(createAccessTokenStore().adoptUrlFragment()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
