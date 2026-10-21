import { apiServiceForPath, createIdentityContextCache, type IdentityContexts } from "@pharmacy/ui";
import { z } from "zod";

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

/**
 * A non-2xx answer from a service. It carries the problem body's `code` and, when the service sent a numeric
 * `Retry-After`, the seconds to wait, so a caller can act on the reason instead of the wording; every caller that
 * only reads `message` keeps working because this is still an `Error`.
 */
export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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
      let code: string | undefined;
      try {
        const problem = (await response.json()) as { title?: string; detail?: string; code?: string };
        detail = problem.detail ?? problem.title ?? detail;
        code = problem.code;
      } catch {
        // Keep the status error when the upstream response is not JSON.
      }
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new ApiError(
        response.status,
        detail,
        code,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
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
  indications: string | null;
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

export type Customer = { id: string; displayName: string; email: string; phoneNumber: string | null };
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
  isDefault: boolean;
  addressNote: string | null;
};

/**
 * One suggestion from the address search, before the shopper has picked one.
 *
 * A suggestion carries no coordinates: Vietmap hands back a label and an opaque handle, and the handle is
 * resolved into a point only once the shopper chooses. This is why the search list is cheap and a selection is
 * the single call that costs something.
 */
export type AddressSearchResult = { displayName: string; refId: string };

/** A prescription the sales service links to the signed-in shopper's account. */
export type CustomerPrescription = {
  id: string;
  prescriptionNumber: string;
  patientName: string;
  doctorName: string | null;
  status: string;
  dispensedAt: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
  }>;
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

/**
 * Names a point the pin was dragged to. A dragged pin has no text of its own, so the label under the map can
 * only stay truthful by asking a geocoder where the pin actually is.
 */
export const reverseGeocode = (destination: {
  latitude: number;
  longitude: number;
}): Promise<{ providerResolvedAddress: string }> =>
  request("/api/delivery/reverse-geocode", { method: "POST", body: JSON.stringify({ destination }) });

export const createOrder = (input: {
  selectedStoreId: string;
  fulfillmentType: "pickup" | "delivery";
  paymentMethod: "sepay_qr" | "cash_on_delivery";
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
const chatbotProductSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  manufacturer: z.string().nullable(),
  prescriptionRequired: z.boolean(),
  imageUrl: z.string().nullable(),
  price: z.object({ amount: z.string(), currency: z.string(), unitName: z.string() }).nullable(),
});
const chatbotReplySchema = z.object({ reply: z.string(), products: z.array(chatbotProductSchema) });
const chatbotSessionSchema = z.object({ id: z.string() });
export type ChatbotProduct = z.infer<typeof chatbotProductSchema>;
export type ChatbotReply = z.infer<typeof chatbotReplySchema>;

class ChatbotResponseError extends Error {
  public constructor() {
    super("Chatbot returned an unexpected response");
    this.name = "ChatbotResponseError";
  }
}

const parseChatbotResponse = <T>(result: z.ZodSafeParseResult<T>): T => {
  if (!result.success) throw new ChatbotResponseError();
  return result.data;
};

export const startChatbotSession = async (): Promise<z.infer<typeof chatbotSessionSchema>> =>
  parseChatbotResponse(
    chatbotSessionSchema.safeParse(
      await request<unknown>("/api/chatbot/sessions", { method: "POST", body: JSON.stringify({}) }),
    ),
  );
export const sendChatbotMessage = async (sessionId: string, content: string): Promise<ChatbotReply> =>
  parseChatbotResponse(
    chatbotReplySchema.safeParse(
      await request<unknown>(`/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    ),
  );
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
  isDefault?: boolean;
}): Promise<DeliveryAddress> => request("/api/delivery/addresses", { method: "POST", body: JSON.stringify(input) });
export const deleteDeliveryAddress = (id: string): Promise<void> =>
  request(`/api/delivery/addresses/${id}`, { method: "DELETE" });
export const updateDeliveryAddress = (
  id: string,
  input: {
    label?: string;
    latitude?: number;
    longitude?: number;
    providerResolvedAddress?: string;
    addressNote?: string | null;
    isDefault?: boolean;
  },
): Promise<DeliveryAddress> =>
  request(`/api/delivery/addresses/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const listPrescriptions = (): Promise<CustomerPrescription[]> => request("/api/prescriptions?limit=50");

/** The prescription intake answer, mirroring the sales service contract: each line carries the catalog products suggested for it. */
export type PrescriptionIntakeMatch = {
  matchType: "name" | "ingredient";
  strengthMatch: boolean | null;
  dosageFormMatch: boolean | null;
  ingredientsMatch: boolean | null;
  score: number;
  product: CatalogProduct;
};
export type PrescriptionIntakeLine = {
  extracted: {
    rawText: string;
    name: string | null;
    activeIngredients: string[];
    strength: string | null;
    dosageForm: string | null;
    quantity: number | null;
    unit: string | null;
    usage: string | null;
  };
  matches: PrescriptionIntakeMatch[];
};
export type PrescriptionIntakeResult = {
  source: "image" | "qr";
  prescription: {
    code: string | null;
    patientName: string | null;
    facilityName: string | null;
    doctorName: string | null;
    diagnosis: string | null;
    issuedOn: string | null;
  };
  lines: PrescriptionIntakeLine[];
};
export const submitPrescriptionImage = (blob: Blob): Promise<PrescriptionIntakeResult> =>
  request("/api/prescriptions/intake/image", {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
export const submitPrescriptionQr = (payload: string): Promise<PrescriptionIntakeResult> =>
  request("/api/prescriptions/intake/qr", { method: "POST", body: JSON.stringify({ payload }) });

/** A prescription line sent to the pharmacists, flagged when no suggestion could fill it at the chosen store. */
export type PrescriptionConsultationLine = PrescriptionIntakeLine["extracted"] & { needsHelp: boolean };
/** A shopper's request for a pharmacist to find what the suggestions could not, mirroring the sales service contract. */
export type PrescriptionConsultation = {
  id: string;
  siteId: string | null;
  source: PrescriptionIntakeResult["source"];
  prescription: PrescriptionIntakeResult["prescription"];
  lines: PrescriptionConsultationLine[];
  note: string | null;
  status: "Open" | "Answered";
  reply: string | null;
  answeredAt: string | null;
  createdAt: string;
};
/** `requestKey` names one submission, so a retried send never files the same request twice. */
export const requestPrescriptionConsultation = ({
  requestKey,
  ...input
}: {
  requestKey: string;
  source: PrescriptionIntakeResult["source"];
  siteId: string | null;
  prescription: PrescriptionIntakeResult["prescription"];
  lines: PrescriptionConsultationLine[];
  note: string | null;
}): Promise<PrescriptionConsultation> =>
  request("/api/prescriptions/consultations", {
    method: "POST",
    body: JSON.stringify(input),
    idempotencyKey: requestKey,
  });
export const listPrescriptionConsultations = (): Promise<PrescriptionConsultation[]> =>
  request("/api/prescriptions/consultations?limit=50");
export const updateProfile = (input: { displayName?: string; phoneNumber?: string | null }): Promise<Customer> =>
  request("/api/auth/me", { method: "PATCH", body: JSON.stringify(input) });
export const registerCustomer = (email: string, password: string, displayName: string) =>
  request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName }) });
export const loginCustomer = (email: string, password: string) =>
  request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

/** Signing out also drops the signed internal-context cache, so a later guest call cannot replay the old identity. */
export const logoutCustomer = async (): Promise<void> => {
  await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  setSessionSnapshot({ authenticated: false, resolved: true });
  setIdentityContextsEnabled(false);
};

/**
 * The identity service clears the session cookie on a password change, so the caller has to sign in again with the
 * password it just set. The snapshot is dropped for the same reason: the browser is signed out whether or not it says so.
 */
export const changePassword = async (currentPassword: string, nextPassword: string): Promise<void> => {
  await request("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, nextPassword }),
  });
  setSessionSnapshot({ authenticated: false, resolved: true });
  setIdentityContextsEnabled(false);
};

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

/** The service rejects a shorter prefix, and one letter matches most Vietnamese street names. */
export const ADDRESS_SEARCH_MIN_LENGTH = 2;

/**
 * Suggests addresses for what the shopper typed.
 *
 * The browser never holds the Vietmap key. That key is metered, so shipping it in a Vite bundle would let any
 * visitor spend the account's monthly allowance; the sales service holds it and this call goes through it.
 */
export const searchAddress = async (query: string): Promise<AddressSearchResult[]> => {
  const trimmed = query.trim();
  if (trimmed.length < ADDRESS_SEARCH_MIN_LENGTH) return [];
  const payload = await request<{ results: AddressSearchResult[] }>(
    `/api/delivery/addresses/search?q=${encodeURIComponent(trimmed)}`,
  );
  return payload.results;
};

/**
 * Turns the suggestion the shopper picked into the point the rider has to reach.
 *
 * Autocomplete answers with a label and an opaque handle, and the handle is what carries the coordinates, so
 * choosing a suggestion costs a second call. It is the one call a shopper makes per address, not per keystroke.
 */
export const resolveAddressSuggestion = (
  refId: string,
): Promise<{ displayName: string; destination: { latitude: number; longitude: number } }> =>
  request("/api/delivery/addresses/resolve", { method: "POST", body: JSON.stringify({ refId }) });
