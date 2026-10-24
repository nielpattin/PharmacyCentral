/**
 * Query parameters for the catalog lists. Blank or "all" filters are left out, so the request matches the URL's
 * default state. Product search uses the `search` parameter of `/api/products`; price search uses `q`.
 */
const trimmedOrUndefined = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const productListParams = (filters: {
  q: string;
  category: string;
  prescriptionRequired: string;
}): Record<string, string | undefined> => ({
  search: trimmedOrUndefined(filters.q),
  category: trimmedOrUndefined(filters.category),
  prescriptionRequired:
    filters.prescriptionRequired === "true" || filters.prescriptionRequired === "false"
      ? filters.prescriptionRequired
      : undefined,
});

export const priceListParams = (filters: { q: string; status: string }): Record<string, string | undefined> => ({
  q: trimmedOrUndefined(filters.q),
  status: filters.status === "all" ? undefined : trimmedOrUndefined(filters.status),
});
