import { apiServiceForPath, createIdentityContextCache, type IdentityContexts } from "@pharmacy/ui";
import { z } from "zod";

import { getLanguage, type Language } from "./i18n.ts";

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

/**
 * Numbers and dates follow the language the staff member picked, not the browser's locale, so a Vietnamese screen
 * reads `1.750.000` and `4 thg 10, 2026` while the English one reads `1,750,000` and `Oct 4, 2026`. The formatters
 * are built once, because every table cell formats through them.
 */
type Formatters = { quantity: Intl.NumberFormat; dateTime: Intl.DateTimeFormat; date: Intl.DateTimeFormat };

const createFormatters = (locale: string): Formatters => ({
  quantity: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
  dateTime: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
  date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
});
const FORMATTERS: Record<Language, Formatters> = { en: createFormatters("en-US"), vi: createFormatters("vi-VN") };

export const formatQuantity = (value: unknown): string => FORMATTERS[getLanguage()].quantity.format(numberValue(value));

export const formatDateTime = (value: unknown): string => {
  const raw = text(value, "");
  if (!raw) return "-";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : FORMATTERS[getLanguage()].dateTime.format(date);
};

export const formatDate = (value: unknown): string => {
  const raw = text(value, "");
  if (!raw) return "-";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : FORMATTERS[getLanguage()].date.format(date);
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

// Search synonyms: groups of words shoppers may use for one symptom. Mirrors the catalog-service contract
// (search-synonyms). A group is live in search only after a staff member other than its submitter approves it.
const isoDateTime = z.iso.datetime({ offset: true });

const searchSynonymBase = z.object({
  id: z.uuid(),
  terms: z.array(z.string()),
  version: z.number().int(),
  submittedBy: z.uuid(),
  submittedAt: isoDateTime,
});

export const searchSynonymGroupSchema = z.discriminatedUnion("status", [
  searchSynonymBase.extend({ status: z.literal("pending") }),
  searchSynonymBase.extend({
    status: z.literal("approved"),
    approvedBy: z.uuid(),
    approvedAt: isoDateTime,
  }),
]);

export type SearchSynonymGroup = z.infer<typeof searchSynonymGroupSchema>;

const searchSynonymListSchema = z.object({ items: z.array(searchSynonymGroupSchema) });

const SEARCH_SYNONYMS_PATH = "/api/products/search-synonyms";

const searchSynonymPath = (id: string): string => `${SEARCH_SYNONYMS_PATH}/${encodeURIComponent(id)}`;

export const listSearchSynonymGroups = async (): Promise<SearchSynonymGroup[]> =>
  searchSynonymListSchema.parse(await request<unknown>(SEARCH_SYNONYMS_PATH)).items;

export const createSearchSynonymGroup = async (terms: string[]): Promise<SearchSynonymGroup> =>
  searchSynonymGroupSchema.parse(await writeJson<unknown>(SEARCH_SYNONYMS_PATH, "POST", { terms }));

export const updateSearchSynonymGroup = async (
  id: string,
  terms: string[],
  version: number,
): Promise<SearchSynonymGroup> =>
  searchSynonymGroupSchema.parse(await writeJson<unknown>(searchSynonymPath(id), "PUT", { terms, version }));

export const approveSearchSynonymGroup = async (id: string, version: number): Promise<SearchSynonymGroup> =>
  searchSynonymGroupSchema.parse(await writeJson<unknown>(`${searchSynonymPath(id)}/approve`, "POST", { version }));

export const deleteSearchSynonymGroup = async (id: string): Promise<void> => {
  await writeJson<unknown>(searchSynonymPath(id), "DELETE");
};

// System overview: read-only health of the services, queues, and search index. Mirrors the ops-console-service
// contract (`GET /api/system/overview`). Each section is either loaded or unavailable with its own error.
export type SystemSectionResult<T> = { status: "ok"; data: T } | { status: "unavailable"; error: string };

export type SystemService = {
  name: string;
  status: "up" | "down";
  httpStatus: number | null;
  latencyMs: number | null;
  liveStatus: "up" | "down";
  liveHttpStatus: number | null;
  /** Prometheus target_info service_version, latest. */
  version: string | null;
  /** Distinct instances reporting in the last 5 minutes. */
  instances: number | null;
  /** 0..100, from the ops probe; null when there are no samples. */
  uptimePercent24h: number | null;
};

export type SystemLoad = {
  name: string;
  /** 0..1, 5xx over all requests. */
  errorRatio: number | null;
  p95Seconds: number | null;
  outboxOldestSeconds: number | null;
  cpuCores: number | null;
  memoryBytes: number | null;
  eventLoopLagSeconds: number | null;
  dbPoolUsed: number | null;
  dbPoolMax: number | null;
};

export type SystemQueue = {
  name: string;
  ready: number;
  unacknowledged: number;
  consumers: number;
  deadLetter: boolean;
};

export type SystemSearchIndex = { name: string; documents: number };

export type SystemLink = { label: string; url: string };

export type SystemOverview = {
  generatedAt: string;
  services: SystemSectionResult<SystemService[]>;
  load: SystemSectionResult<SystemLoad[]>;
  queues: SystemSectionResult<SystemQueue[]>;
  searchIndex: SystemSectionResult<SystemSearchIndex[]>;
  links: SystemLink[];
};

export const readSystemOverview = (): Promise<SystemOverview> => readOne<SystemOverview>("/api/system/overview");

export const SYSTEM_METRICS_WINDOWS_MINUTES = [15, 60, 360, 1440] as const;
export type SystemMetricsWindowMinutes = (typeof SYSTEM_METRICS_WINDOWS_MINUTES)[number];

// Each point is [unix seconds, value or null].
export type SystemMetricPoint = readonly [unixSeconds: number, value: number | null];

// Metrics range: one service's time series from Prometheus, for the detail sheet's charts.
export type SystemMetricsRange = {
  generatedAt: string;
  service: string;
  from: number;
  to: number;
  stepSeconds: number;
  series: {
    cpuCores: SystemMetricPoint[];
    memoryBytes: SystemMetricPoint[];
    eventLoopLagSeconds: SystemMetricPoint[];
  };
};

export const readSystemMetricsRange = (
  service: string,
  windowMinutes: SystemMetricsWindowMinutes,
): Promise<SystemMetricsRange> =>
  readOne<SystemMetricsRange>(
    `/api/system/metrics/range?${new URLSearchParams({ service, windowMinutes: String(windowMinutes) }).toString()}`,
  );

// Metrics summary: availability per configured service over the window, for the uptime strips.
export type SystemMetricsSummary = {
  generatedAt: string;
  from: number;
  to: number;
  stepSeconds: number;
  services: Record<string, { availability: SystemMetricPoint[] }>;
};

export const readSystemMetricsSummary = (windowMinutes: SystemMetricsWindowMinutes): Promise<SystemMetricsSummary> =>
  readOne<SystemMetricsSummary>(
    `/api/system/metrics/summary?${new URLSearchParams({ windowMinutes: String(windowMinutes) }).toString()}`,
  );
