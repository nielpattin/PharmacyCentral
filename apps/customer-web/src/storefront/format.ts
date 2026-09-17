const vndFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const quantityFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });
const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

const CURRENCY_SUFFIXES: Record<string, string> = { VND: "đ" };

export const formatMoney = (amount: number | string, currency: string): string => {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return "—";
  const suffix = CURRENCY_SUFFIXES[currency.toUpperCase()];
  const formatted = currency.toUpperCase() === "VND" ? vndFormatter.format(value) : decimalFormatter.format(value);
  return suffix ? `${formatted}${suffix}` : `${formatted} ${currency.toUpperCase()}`;
};

export const formatDistance = (meters: number): string =>
  meters >= 1000 ? `${decimalFormatter.format(meters / 1000)} km` : `${vndFormatter.format(Math.round(meters))} m`;

export const formatQuantity = (quantity: number | string): string => {
  const value = Number(quantity);
  return Number.isFinite(value) ? quantityFormatter.format(value) : "—";
};

export const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateTimeFormatter.format(parsed);
};

export const initials = (text: string, max = 2): string =>
  text
    .split(/[\s-]+/)
    .filter((part) => /[a-z0-9]/i.test(part))
    .slice(0, max)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
