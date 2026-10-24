export const TABLE_DENSITIES = ["compact", "standard", "loose"] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

export type TablePreferences = {
  readonly density: TableDensity;
  readonly hiddenColumns: readonly string[];
};

export const DEFAULT_TABLE_PREFERENCES: TablePreferences = { density: "standard", hiddenColumns: [] };

const SCHEMA_VERSION = 1;
const STORAGE_PREFIX = "pharmacy-central.table.";

const isDensity = (value: unknown): value is TableDensity =>
  typeof value === "string" && (TABLE_DENSITIES as readonly string[]).includes(value);

/** Validates a stored preferences document. Anything that does not match the current schema is ignored (null). */
export const parseTablePreferences = (raw: string | null): TablePreferences | null => {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { version, density, hiddenColumns } = value as Record<string, unknown>;
  if (version !== SCHEMA_VERSION || !isDensity(density)) return null;
  if (!Array.isArray(hiddenColumns)) return null;
  const keys: string[] = [];
  for (const key of hiddenColumns) {
    if (typeof key !== "string") return null;
    keys.push(key);
  }
  return { density, hiddenColumns: [...new Set(keys)] };
};

export const serializeTablePreferences = (preferences: TablePreferences): string =>
  JSON.stringify({
    version: SCHEMA_VERSION,
    density: preferences.density,
    hiddenColumns: [...preferences.hiddenColumns],
  });

export const readTablePreferences = (storageKey: string): TablePreferences | null => {
  try {
    return parseTablePreferences(globalThis.localStorage?.getItem(STORAGE_PREFIX + storageKey) ?? null);
  } catch {
    return null;
  }
};

export const writeTablePreferences = (storageKey: string, preferences: TablePreferences): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + storageKey, serializeTablePreferences(preferences));
  } catch {
    // Storage is full or blocked: the preferences still apply for this session.
  }
};
