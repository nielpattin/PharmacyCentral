import { apiServiceForPath, createIdentityContextCache, type IdentityContexts } from "@pharmacy/ui";

import { setSessionSnapshot } from "./auth.ts";

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
      let detail = `Không thực hiện được yêu cầu (mã ${response.status})`;
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

export type CatalogUnit = {
  id: string;
  productId: string;
  unitName: string;
  conversionFactorToBaseUnit: string;
  isBaseUnit: boolean;
  isDefaultSaleUnit: boolean;
  isDefaultPurchaseUnit: boolean;
  barcode: string | null;
  sortOrder: number;
};
export type CatalogProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  genericName: string | null;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  packageDescription: string | null;
  registrationNumber: string | null;
  prescriptionRequired: boolean;
  imageUrl: string | null;
  category: string | null;
  manufacturer: string | null;
  status: string;
  notes: string | null;
  isActive: boolean;
  units: CatalogUnit[];
};
export type CatalogPrice = {
  id: string;
  productId: string;
  productUnitId: string;
  siteId: string | null;
  unitPrice: string;
  currency: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};
export type CatalogAvailability = { productId: string; siteId: string; inStock: boolean; updatedAt: string };
export type CatalogStore = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  straightLineMeters?: number;
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
export type OrderLine = {
  productId: string;
  productUnitId: string;
  productNameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: string;
};

export type Customer = { id: string; displayName: string; email: string };
/** A row of `GET /orders`: the sales service lists orders without their lines or delivery snapshot. */
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
};

/** `POST /orders` and `GET /orders/:id` answer with the order, its lines, and the delivery snapshot when there is one. */
export type CustomerOrderDetail = CustomerOrder & {
  lines: OrderLine[];
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

export type ProductQuery = {
  search?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
};

export const listProducts = (query: ProductQuery = {}): Promise<CatalogProduct[]> => {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit ?? 60));
  if (query.search) params.set("search", query.search);
  if (query.category) params.set("category", query.category);
  return request(`/api/products?${params.toString()}`);
};
export const getProduct = (id: string): Promise<CatalogProduct> => request(`/api/products/${id}`);
export const listStores = (): Promise<CatalogStore[]> => request("/api/stores?limit=50");
export const listNearestStores = (latitude: number, longitude: number, limit = 5): Promise<CatalogStore[]> =>
  request(`/api/stores/nearest?latitude=${latitude}&longitude=${longitude}&limit=${limit}`);
export const listPublishedPrices = (): Promise<CatalogPrice[]> =>
  request("/api/pricing/prices?status=Published&limit=500");
export const listAvailability = (siteId?: string): Promise<CatalogAvailability[]> => {
  const params = new URLSearchParams();
  if (siteId) params.set("siteId", siteId);
  return request(`/api/availability${params.size ? `?${params.toString()}` : ""}`);
};
export const getProductUnits = (productId: string): Promise<CatalogUnit[]> =>
  request(`/api/products/${productId}/units`);
export const getActivePrice = (productId: string, productUnitId: string): Promise<CatalogPrice> =>
  request(
    `/api/pricing/active?productId=${productId}&productUnitId=${productUnitId}&effectiveDate=${new Date().toISOString().slice(0, 10)}`,
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
}): Promise<CustomerOrderDetail> =>
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
export const getOrder = (id: string): Promise<CustomerOrderDetail> => request(`/api/orders/${id}`);
/** The invoice as the payment service has it now, which is how a shopper's page learns the transfer has landed. */
export const getPaymentInvoice = (id: string): Promise<PaymentInvoice> => request(`/api/payments/invoices/${id}`);
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

export const currentUser = (): Promise<Customer | undefined> => request("/api/auth/me");

/**
 * Resolves the shopper's session for a page that can be opened directly: probes the session cookie and publishes the
 * answer, so a deep link or a reload shows the right UI instead of guessing "signed out".
 */
export const resolveCustomerSession = async (): Promise<Customer | undefined> => {
  await request("/api/auth/csrf");
  const customer = await currentUser().catch(() => undefined);
  if (!customer) {
    setSessionSnapshot({ authenticated: false, resolved: true });
    return undefined;
  }
  setSessionSnapshot({ authenticated: true, resolved: true, userId: customer.id });
  setIdentityContextsEnabled(true);
  return customer;
};
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
