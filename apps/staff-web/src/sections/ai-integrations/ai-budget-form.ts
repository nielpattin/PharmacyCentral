// Mirrors the chatbot-service AI budget contract. staff-web cannot import service code.
export type ConfiguredModel = {
  purpose: string;
  label: string;
  provider: string;
  model: string;
  price: {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    imageUsdPerImage: number | null;
    updatedAt: string;
    updatedBy: string;
  } | null;
};

export type AiBudgetView = {
  timezone: string;
  limits: { dailyUsd: number | null; monthlyUsd: number | null };
  spend: { todayUsd: number; monthUsd: number; todayStart: string; monthStart: string };
  models: ConfiguredModel[];
};

// Up to six decimals, the precision the server stores. Parsing with a pattern avoids float rounding in the check.
const USD_PATTERN = /^\d+(\.\d{1,6})?$/;

/** A parsed amount: the number, or null for "no value typed". `invalid` means the text is not a valid amount. */
export type ParsedUsd = { kind: "ok"; value: number } | { kind: "empty" } | { kind: "invalid" };

export const parseUsd = (text: string): ParsedUsd => {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  if (!USD_PATTERN.test(trimmed)) return { kind: "invalid" };
  return { kind: "ok", value: Number(trimmed) };
};

export type LimitForm = { daily: string; monthly: string };

export const limitFormFrom = (view: AiBudgetView): LimitForm => ({
  daily: view.limits.dailyUsd === null ? "" : String(view.limits.dailyUsd),
  monthly: view.limits.monthlyUsd === null ? "" : String(view.limits.monthlyUsd),
});

/** A blank limit means no limit. Returns undefined when a typed limit is not a valid amount. */
export const limitBody = (
  form: LimitForm,
): { dailyLimitUsd: number | null; monthlyLimitUsd: number | null } | undefined => {
  const daily = parseUsd(form.daily);
  const monthly = parseUsd(form.monthly);
  if (daily.kind === "invalid" || monthly.kind === "invalid") return undefined;
  return {
    dailyLimitUsd: daily.kind === "ok" ? daily.value : null,
    monthlyLimitUsd: monthly.kind === "ok" ? monthly.value : null,
  };
};

export type PriceForm = { input: string; output: string; image: string };

export const priceFormFrom = (model: ConfiguredModel): PriceForm => ({
  input: model.price ? String(model.price.inputUsdPerMillion) : "",
  output: model.price ? String(model.price.outputUsdPerMillion) : "",
  image: model.price?.imageUsdPerImage == null ? "" : String(model.price.imageUsdPerImage),
});

/** Input and output are required; the image price is optional. */
export const priceBody = (
  model: Pick<ConfiguredModel, "provider" | "model">,
  form: PriceForm,
): Record<string, unknown> | undefined => {
  const input = parseUsd(form.input);
  const output = parseUsd(form.output);
  const image = parseUsd(form.image);
  if (input.kind !== "ok" || output.kind !== "ok" || image.kind === "invalid") return undefined;
  return {
    provider: model.provider,
    model: model.model,
    inputUsdPerMillion: input.value,
    outputUsdPerMillion: output.value,
    imageUsdPerImage: image.kind === "ok" ? image.value : null,
  };
};

/** `$1.25`, or the words for an unset value. Six decimals are shown only when the value has them. */
export const formatUsd = (value: number): string => `$${Number(value.toFixed(6)).toString()}`;

export const formatLimit = (value: number | null, unlimited: string): string =>
  value === null ? unlimited : formatUsd(value);
