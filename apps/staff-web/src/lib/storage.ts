/**
 * Browser storage access for persisted UI state (saved views, drafts, sidebar). Reads tolerate malformed JSON and
 * blocked storage by returning undefined, so a broken entry never breaks a page.
 *
 * Usage: `const raw = readStoredJson(browserStorage(), key)`, then validate `raw` with a zod schema.
 */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const browserStorage = (): KeyValueStorage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    // Storage access throws in sandboxed frames and when the user blocks site data.
    return undefined;
  }
};

export const readStoredJson = (storage: KeyValueStorage | undefined, key: string): unknown => {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
};

export const writeStoredJson = (storage: KeyValueStorage | undefined, key: string, value: unknown): void => {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota errors only lose persisted convenience state, never the work on screen.
  }
};

export const removeStoredJson = (storage: KeyValueStorage | undefined, key: string): void => {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to remove when storage is unavailable.
  }
};
