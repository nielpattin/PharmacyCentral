import { apiServiceForPath, createIdentityContextCache, type IdentityContexts } from "@pharmacy/ui";

export type ApiRequestOptions = RequestInit & {
  csrfToken?: string;
  idempotencyKey?: string;
};

let identityContextsEnabled = false;

const identityContextCache = createIdentityContextCache(async () => {
  const response = await fetch("/api/auth/context", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Identity contexts unavailable (${response.status})`);
  return (await response.json()) as IdentityContexts;
});

export const setIdentityContextsEnabled = (enabled: boolean): void => {
  identityContextsEnabled = enabled;
  if (!enabled) identityContextCache.invalidate();
};

export const request = async <T>(url: string, options: ApiRequestOptions = {}): Promise<T> => {
  const attempt = async (retried: boolean): Promise<T> => {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const browserCsrfToken =
      typeof document === "undefined" ? undefined : document.cookie.match(/(?:^|;\s*)pharmacy_csrf=([^;]+)/)?.[1];
    if (options.csrfToken ?? browserCsrfToken) headers.set("X-CSRF-TOKEN", options.csrfToken ?? browserCsrfToken ?? "");
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    const service = apiServiceForPath(url);
    if (service && identityContextsEnabled && !headers.has("x-internal-identity-context")) {
      const token = await identityContextCache.tokenFor(service);
      if (token) headers.set("x-internal-identity-context", token);
    }
    const response = await fetch(url, { ...options, credentials: "include", headers });
    if (response.status === 401 && service && identityContextsEnabled && !retried) {
      identityContextCache.invalidate();
      return attempt(true);
    }
    if (!response.ok) {
      let detail = `API request failed with status ${response.status}`;
      try {
        const problem = (await response.json()) as { title?: string; detail?: string };
        detail = problem.detail ?? problem.title ?? detail;
      } catch {
        // Keep the status error when the upstream response is not JSON.
      }
      throw new Error(detail);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };
  return attempt(false);
};

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  isActive?: boolean;
};
export type CatalogUnit = { id: string; unitName: string; conversionFactorToBaseUnit: string };
export type CatalogPrice = { productId: string; productUnitId: string; unitPrice: string; currency: string };
export type CatalogStore = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  coordinates?: { latitude: number; longitude: number } | null;
  latitude?: number;
  longitude?: number;
};
export type CartLine = { id: string; productId: string; productUnitId: string; quantity: string };
export type Cart = { id: string; lines: CartLine[] };
export type DeliveryCalculation = {
  selectedStoreId: string;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  providerResolvedAddress: string;
  addressNote: string | null;
  distanceMeters: number;
  durationSeconds: number;
  fee: number;
  currency: string;
  route: { type: "LineString"; coordinates: Array<[number, number]> };
};
export type CustomerOrder = {
  id: string;
  status: string;
  paymentStatus: string;
  fulfillmentType: "pickup" | "delivery";
  selectedStoreId: string;
  subtotal: string;
  deliveryFee: string;
  currency: string;
  createdAt: string;
  lines: Array<{
    productId: string;
    productUnitId: string;
    productNameSnapshot: string;
    unitPriceSnapshot: string;
    quantity: string;
  }>;
  delivery?: {
    providerResolvedAddress: string;
    addressNote: string | null;
    distanceMeters: string;
    durationSeconds: string;
    routeGeoJson: string;
  };
};
export type DeliveryAddress = {
  id: string;
  label: string;
  latitude: string;
  longitude: string;
  providerResolvedAddress: string;
  addressNote: string | null;
};
export type PaymentInvoice = {
  id: string;
  paymentCode: string;
  amount: string;
  currency: string;
  status: string;
  paymentInstruction?: { qrImageUrl: string; transferContent: string };
};

export const listProducts = (search = ""): Promise<CatalogProduct[]> =>
  request(`/api/products?limit=20${search ? `&search=${encodeURIComponent(search)}` : ""}`);
export const listStores = (): Promise<CatalogStore[]> => request("/api/stores?limit=50");
export const getProductUnits = (productId: string): Promise<CatalogUnit[]> =>
  request(`/api/products/${productId}/units`);
export const getActivePrice = (productId: string, productUnitId: string, siteId: string): Promise<CatalogPrice> =>
  request(
    `/api/pricing/active?productId=${productId}&productUnitId=${productUnitId}&siteId=${siteId}&effectiveDate=${new Date().toISOString().slice(0, 10)}`,
  );
export const getCart = (): Promise<Cart> => request("/api/carts");
export const clearCart = (): Promise<Cart> => request("/api/carts", { method: "DELETE", body: JSON.stringify({}) });
export const addCartLine = (productId: string, productUnitId: string, quantity: number): Promise<Cart> =>
  request("/api/carts/lines", { method: "POST", body: JSON.stringify({ productId, productUnitId, quantity }) });
export const updateCartLine = (lineId: string, quantity: number): Promise<Cart> =>
  request(`/api/carts/lines/${lineId}`, { method: "PATCH", body: JSON.stringify({ quantity }) });
export const mergeGuestCart = (): Promise<Cart> =>
  request("/api/carts/merge", { method: "POST", body: JSON.stringify({}) });
export const calculateDelivery = (
  selectedStoreId: string,
  destination: { latitude: number; longitude: number },
  addressNote: string,
): Promise<DeliveryCalculation> =>
  request("/api/delivery/calculate", {
    method: "POST",
    body: JSON.stringify({ selectedStoreId, destination, addressNote }),
  });
export const createOrder = (input: {
  selectedStoreId: string;
  fulfillmentType: "pickup" | "delivery";
  lines: Array<{ productId: string; productUnitId: string; quantity: number }>;
  delivery?: { destination: { latitude: number; longitude: number }; addressNote?: string };
}): Promise<CustomerOrder> =>
  request("/api/orders", { method: "POST", body: JSON.stringify(input), idempotencyKey: crypto.randomUUID() });
export const createPaymentInvoice = (input: {
  invoiceId: string;
  orderId: string;
  paymentMethod: "sepay_qr" | "cash_on_delivery";
  lines: Array<{
    productId: string;
    productUnitId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    currency: string;
  }>;
}): Promise<PaymentInvoice> =>
  request("/api/payments/invoices", { method: "POST", body: JSON.stringify(input), idempotencyKey: input.invoiceId });
export const listOrders = (): Promise<CustomerOrder[]> => request("/api/orders");
export const getOrder = (id: string): Promise<CustomerOrder> => request(`/api/orders/${id}`);
export const listDeliveryAddresses = (): Promise<DeliveryAddress[]> => request("/api/delivery/addresses");
export const saveDeliveryAddress = (input: {
  label: string;
  latitude: number;
  longitude: number;
  providerResolvedAddress: string;
  addressNote?: string;
}): Promise<DeliveryAddress> => request("/api/delivery/addresses", { method: "POST", body: JSON.stringify(input) });
export const registerCustomer = (email: string, password: string, displayName: string) =>
  request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName }) });
export const loginCustomer = (email: string, password: string) =>
  request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const currentUser = (): Promise<{ id: string; displayName: string; email: string } | undefined> =>
  request("/api/auth/me");
export const searchAddress = async (
  query: string,
): Promise<{ displayName: string; latitude: number; longitude: number }[]> => {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new Error("Address search failed");
  const rows = (await response.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return rows.map((row) => ({ displayName: row.display_name, latitude: Number(row.lat), longitude: Number(row.lon) }));
};
