import { apiServiceForPath, createIdentityContextCache, type IdentityContexts } from "@pharmacy/ui";

export type ApiRequestOptions = RequestInit & {
  csrfToken?: string;
  idempotencyKey?: string;
};

export type ApiProblemIssue = { path: string; message: string };

// Problem details returned by the services (title, code, and per-field issues).
export type ApiProblem = {
  title?: string;
  detail?: string;
  status?: number;
  code?: string;
  errors?: ApiProblemIssue[];
};

export class ApiProblemError extends Error {
  public constructor(
    message: string,
    public readonly problem: ApiProblem,
  ) {
    super(message);
    this.name = "ApiProblemError";
  }
}

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
      let problem: ApiProblem = { status: response.status };
      try {
        const body = (await response.json()) as ApiProblem;
        problem = { ...body, status: response.status };
        detail = body.detail ?? body.title ?? detail;
      } catch {
        // Keep the status error when the upstream response is not JSON.
      }
      throw new ApiProblemError(detail, problem);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };
  return attempt(false);
};

export type JsonRecord = Record<string, unknown>;

export const asRows = (value: unknown): JsonRecord[] => {
  if (Array.isArray(value))
    return value.filter((item): item is JsonRecord => typeof item === "object" && item !== null);
  if (typeof value === "object" && value !== null) {
    const record = value as JsonRecord;
    for (const key of ["items", "rows", "data", "results"]) {
      if (Array.isArray(record[key]))
        return record[key].filter((item): item is JsonRecord => typeof item === "object" && item !== null);
    }
  }
  return [];
};

export const text = (value: unknown, fallback = "-"): string => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return `${value}`;
  return fallback;
};

export const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const formatQuantity = (value: unknown): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(numberValue(value));

export const formatDateTime = (value: unknown): string => {
  const raw = text(value, "");
  if (!raw) return "-";
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export const formatDate = (value: unknown): string => {
  const raw = text(value, "");
  if (!raw) return "-";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
};

export const idOf = (row: JsonRecord): string => text(row.id ?? row.productId ?? row.siteId ?? row.purchaseOrderId);

export const readRows = async (path: string): Promise<JsonRecord[]> => asRows(await request<unknown>(path));

export const readOne = async <T = JsonRecord>(path: string): Promise<T> => request<T>(path);

/**
 * The counter's customer picker: identity-service matches the exact phone or email the patient gives, and answers
 * only customer accounts. Fewer than three characters is refused there, so callers trim before sending.
 */
export const lookupCustomers = (query: string): Promise<JsonRecord[]> =>
  readRows(`/api/customers/lookup?q=${encodeURIComponent(query.trim())}`);

export const writeJson = async <T = JsonRecord>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: JsonRecord,
): Promise<T> => request<T>(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });

export const action = async <T = JsonRecord>(path: string, value: string): Promise<T> =>
  writeJson<T>(path, "POST", { action: value });

// Prescription consultations: a shopper hands the whole read prescription to a pharmacist when no catalog product
// fills one of its lines as prescribed. These mirror the sales-service consultation contract.
export type PrescriptionConsultationStatus = "Open" | "Answered";

export type ConsultationLine = {
  /** The line as printed on the prescription. */
  rawText: string;
  /** Prescribed name, kept only when the source stated one. */
  name: string | null;
  activeIngredients: string[];
  strength: string | null;
  dosageForm: string | null;
  quantity: number | null;
  unit: string | null;
  usage: string | null;
  /** Set by the shopper's page when no suggestion could fill the line as prescribed at the chosen store. */
  needsHelp: boolean;
};

/** Header fields read from the prescription; each is null when the source did not state it. */
export type ConsultationPrescription = {
  code: string | null;
  patientName: string | null;
  facilityName: string | null;
  doctorName: string | null;
  diagnosis: string | null;
  issuedOn: string | null;
};

export type PrescriptionConsultation = {
  id: string;
  customerId: string;
  siteId: string | null;
  source: "image" | "qr";
  prescription: ConsultationPrescription;
  lines: ConsultationLine[];
  note: string | null;
  status: PrescriptionConsultationStatus;
  reply: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const listPrescriptionConsultations = async (
  options: { status?: PrescriptionConsultationStatus } = {},
): Promise<PrescriptionConsultation[]> => {
  const query = new URLSearchParams({ limit: "100" });
  if (options.status) query.set("status", options.status);
  return request<PrescriptionConsultation[]>(`/api/prescriptions/consultations?${query.toString()}`);
};

export const answerPrescriptionConsultation = async (id: string, reply: string): Promise<PrescriptionConsultation> =>
  writeJson<PrescriptionConsultation>(`/api/prescriptions/consultations/${encodeURIComponent(id)}/answer`, "POST", {
    reply,
  });
