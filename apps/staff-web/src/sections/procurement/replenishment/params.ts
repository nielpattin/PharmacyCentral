/**
 * The four request parameters of `GET /api/procurement/replenishment-suggestions` (design 0007, "Contracts"). They are
 * shown on the screen and kept in the URL; they are not environment settings. The ranges are the API's. Pure rules, no
 * React or API imports, so node can test them.
 */
export const SUGGESTION_PARAM_RULES = {
  windowDays: { min: 7, max: 180, defaultValue: 30 },
  coverDays: { min: 1, max: 90, defaultValue: 14 },
  safetyDays: { min: 0, max: 60, defaultValue: 7 },
  defaultLeadTimeDays: { min: 1, max: 90, defaultValue: 7 },
} as const;

export type SuggestionParamKey = keyof typeof SUGGESTION_PARAM_RULES;

export const SUGGESTION_PARAM_KEYS: readonly SuggestionParamKey[] = [
  "windowDays",
  "coverDays",
  "safetyDays",
  "defaultLeadTimeDays",
];

export type SuggestionParams = Record<SuggestionParamKey, number>;

/** The parameters as the URL and the inputs hold them: text, so a half-typed value can be kept. */
export type SuggestionParamText = Record<SuggestionParamKey, string>;

/** URL defaults. A value equal to its default stays out of the URL. Kept equal to `SUGGESTION_PARAM_RULES` by a test. */
export const SUGGESTION_PARAM_DEFAULTS: SuggestionParamText = {
  windowDays: "30",
  coverDays: "14",
  safetyDays: "7",
  defaultLeadTimeDays: "7",
};

/** A whole number inside the key's range, or undefined. The text is trimmed; "7.5", "1e2", "" and "-1" are refused. */
export const parseSuggestionParam = (key: SuggestionParamKey, value: string): number | undefined => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  const rule = SUGGESTION_PARAM_RULES[key];
  return parsed >= rule.min && parsed <= rule.max ? parsed : undefined;
};

export type SuggestionParamsResult =
  | { ok: true; params: SuggestionParams }
  | { ok: false; invalid: SuggestionParamKey[] };

/** All four parameters as numbers, or the keys that are not valid. */
export const readSuggestionParams = (values: SuggestionParamText): SuggestionParamsResult => {
  const found = {
    windowDays: parseSuggestionParam("windowDays", values.windowDays),
    coverDays: parseSuggestionParam("coverDays", values.coverDays),
    safetyDays: parseSuggestionParam("safetyDays", values.safetyDays),
    defaultLeadTimeDays: parseSuggestionParam("defaultLeadTimeDays", values.defaultLeadTimeDays),
  };
  const { windowDays, coverDays, safetyDays, defaultLeadTimeDays } = found;
  if (
    windowDays === undefined ||
    coverDays === undefined ||
    safetyDays === undefined ||
    defaultLeadTimeDays === undefined
  ) {
    return { ok: false, invalid: SUGGESTION_PARAM_KEYS.filter((key) => found[key] === undefined) };
  }
  return { ok: true, params: { windowDays, coverDays, safetyDays, defaultLeadTimeDays } };
};
