/**
 * URL-held list state. A page declares its search keys with defaults once. A value equal to its default stays out of
 * the URL, and params the page does not declare (for example another page's `tab`) survive every write.
 *
 * Usage: see hooks/useListUrlState.ts. These pure helpers exist so the rules can be unit tested.
 */
export type ListDefaults = Readonly<Record<string, string>>;

export type ListValues<D extends ListDefaults> = { readonly [K in keyof D]: string };

export const parseListSearch = <D extends ListDefaults>(
  search: Readonly<Record<string, unknown>>,
  defaults: D,
): ListValues<D> => {
  const values: Record<string, string> = {};
  for (const key of Object.keys(defaults)) {
    const raw = Object.hasOwn(search, key) ? search[key] : undefined;
    values[key] = typeof raw === "string" && raw !== "" ? raw : (defaults[key] ?? "");
  }
  return values as ListValues<D>;
};

/** Only declared keys whose value differs from the default and is not empty. */
export const serializeListValues = (
  values: Readonly<Record<string, string>>,
  defaults: ListDefaults,
): Record<string, string> => {
  const serialized: Record<string, string> = {};
  for (const key of Object.keys(defaults)) {
    const value = values[key];
    if (value !== undefined && value !== "" && value !== defaults[key]) serialized[key] = value;
  }
  return serialized;
};

/** Replaces the declared keys of the current search with the serialized values and keeps every other param. */
export const applyListSearch = (
  current: Readonly<Record<string, unknown>>,
  values: Readonly<Record<string, string>>,
  defaults: ListDefaults,
): Record<string, unknown> => {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!Object.hasOwn(defaults, key)) next[key] = value;
  }
  return { ...next, ...serializeListValues(values, defaults) };
};
