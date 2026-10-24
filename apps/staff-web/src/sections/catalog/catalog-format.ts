/** Replaces `{name}` tokens with their values. A token without a value stays as written. */
export const fillTemplate = (template: string, values: Record<string, number | string>): string =>
  template.replace(/\{(\w+)\}/g, (token, name: string) => (name in values ? String(values[name]) : token));

/** An amount with its currency. A code that is not three letters shows the amount alone. */
export const formatPrice = (amount: unknown, currency: unknown, locale: string): string => {
  if (amount === null || amount === undefined || amount === "") return "-";
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return "-";
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const options: Intl.NumberFormatOptions = /^[A-Z]{3}$/.test(code)
    ? { style: "currency", currency: code, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat(locale, options).format(value);
};

/** Trimmed text, or null when it is blank. */
export const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};
