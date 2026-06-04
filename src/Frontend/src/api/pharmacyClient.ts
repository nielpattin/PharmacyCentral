import { getLanguage, translate } from "../lib/i18n";
import type { SiteTypeValue, StorageLocationTypeValue } from "../pages/shared/pharmacyTypes";

export type AuthUserDetails = {
   displayName: string;
   email: string;
   roles: string[];
   siteIds: string[];
   isPlatformAdmin: boolean;
};

export type LoginRequest = {
   email: string;
   password: string;
};

type CsrfTokenResponse = {
   token: string;
};

export type SiteDto = {
   id: string;
   code: string;
   name: string;
   siteType: SiteTypeValue;
   status: string;
   address: string | null;
   notes: string | null;
   isActive: boolean;
   createdAtUtc: string;
   updatedAtUtc: string;
};

export type StorageLocationDto = {
   id: string;
   siteId: string;
   code: string;
   name: string;
   locationType: StorageLocationTypeValue;
   status: string;
   capacity: number | null;
   isActive: boolean;
   createdAtUtc: string;
   updatedAtUtc: string;
};

export type ProductDto = {
   id: string;
   sku: string;
   name: string;
   category: string | null;
   unit: string | null;
   manufacturer: string | null;
   status: string;
   notes: string | null;
   isActive: boolean;
   createdAtUtc: string;
   updatedAtUtc: string;
};

export type SupplierDto = {
   id: string;
   code: string;
   name: string;
   contactName: string | null;
   email: string | null;
   phone: string | null;
   address: string | null;
   status: string;
   notes: string | null;
   isActive: boolean;
   createdAtUtc: string;
   updatedAtUtc: string;
};

export type GoodsReceiptLineDto = {
   id: string;
   productId: string;
   productBatchId: string | null;
   batchNumber: string;
   expiryDate: string;
   manufacturedDate: string | null;
   manufacturer: string | null;
   quantity: number;
   notes: string | null;
};

export type GoodsReceiptDto = {
   id: string;
   supplierId: string;
   siteId: string;
   storageLocationId: string;
   receiptNumber: string;
   status: string;
   receivedAtUtc: string;
   notes: string | null;
   createdAtUtc: string;
   lines: GoodsReceiptLineDto[];
};

export type InventoryBalanceDto = {
   id: string;
   productId: string;
   productSku: string;
   productName: string;
   productBatchId: string;
   batchNumber: string;
   expiryDate: string;
   manufacturedDate: string | null;
   supplierId: string | null;
   manufacturer: string | null;
   siteId: string;
   storageLocationId: string;
   quantityOnHand: number;
   quantityReserved: number;
   createdAtUtc: string;
   updatedAtUtc: string;
};

export type StockLedgerEntryDto = {
   id: string;
   productId: string;
   productSku: string;
   productName: string;
   productBatchId: string;
   batchNumber: string;
   expiryDate: string;
   siteId: string;
   storageLocationId: string;
   movementType: string;
   quantityDelta: number;
   balanceAfter: number;
   occurredAtUtc: string;
   referenceType: string | null;
   referenceId: string | null;
   reason: string | null;
   notes: string | null;
   createdByUserId: string | null;
   createdAtUtc: string;
};

export type AuditLogEntryDto = {
   id: string;
   action: string;
   entityType: string;
   entityId: string | null;
   userId: string | null;
   siteId: string | null;
   summary: string | null;
   details: string | null;
   occurredAtUtc: string;
};

export type DashboardActivityDto = {
   id: string;
   action: string;
   entityType: string;
   entityId: string | null;
   userId: string | null;
   siteId: string | null;
   summary: string | null;
   occurredAtUtc: string;
};

export type DashboardSummaryDto = {
   totalSites: number;
   activeSites: number;
   totalStorageLocations: number;
   activeStorageLocations: number;
   totalProducts: number;
   totalSuppliers: number;
   totalQuantityOnHand: number;
   totalQuantityReserved: number;
   lowStockBatchCount: number;
   expiringBatchCount: number;
   pendingTransferCount: number;
   openPrescriptionCount: number;
   openStocktakeCount: number;
   pendingAdjustmentCount: number;
   recentActivity: DashboardActivityDto[];
};

export type SiteUpsertRequest = {
   code: string;
   name: string;
   siteType: SiteTypeValue;
   status: string;
   address: string;
   notes: string;
   isActive: boolean;
};

export type StorageLocationUpsertRequest = {
   siteId: string;
   code: string;
   name: string;
   locationType: StorageLocationTypeValue;
   status: string;
   capacity: number | null;
   isActive: boolean;
};

export type ProductUpsertRequest = {
   sku: string;
   name: string;
   category: string;
   unit: string;
   manufacturer: string;
   status: string;
   notes: string;
   isActive: boolean;
};

export type SupplierUpsertRequest = {
   code: string;
   name: string;
   contactName: string;
   email: string;
   phone: string;
   address: string;
   status: string;
   notes: string;
   isActive: boolean;
};

export type GoodsReceiptUpsertRequest = {
   supplierId: string;
   siteId: string;
   storageLocationId: string;
   receiptNumber: string;
   notes: string | null;
   lines: GoodsReceiptLineUpsertRequest[];
};

export type GoodsReceiptLineUpsertRequest = {
   productId: string;
   batchNumber: string;
   expiryDate: string;
   manufacturedDate: string | null;
   manufacturer: string | null;
   quantity: number;
   notes: string | null;
};

export type CountSheetLineDetails = {
   id: string;
   stocktakeSessionId: string;
   productId: string;
   productBatchId: string;
   expectedQuantity: number;
   countedQuantity: number;
   variance: number;
   status: string;
   notes: string | null;
};

export type StocktakeSessionDetails = {
   id: string;
   siteId: string;
   storageLocationId: string;
   status: string;
   startedAtUtc: string;
   completedAtUtc: string | null;
   notes: string | null;
   createdByUserId: string | null;
   createdAtUtc: string;
   updatedAtUtc: string;
   countSheetLines: CountSheetLineDetails[];
};

export type StockAdjustmentDetails = {
   id: string;
   stocktakeSessionId: string | null;
   productId: string;
   productBatchId: string;
   siteId: string;
   storageLocationId: string;
   adjustmentType: string;
   quantity: number;
   reason: string;
   approvedByUserId: string | null;
   approvedAtUtc: string | null;
   status: string;
   notes: string | null;
   createdByUserId: string | null;
   createdAtUtc: string;
   updatedAtUtc: string;
};

export type StocktakeSessionCreateRequest = {
   siteId: string;
   storageLocationId: string;
   notes: string | null;
};

export type CountSheetLineUpsertRequest = {
   productId: string;
   productBatchId: string;
   countedQuantity: number;
   notes: string | null;
};

export type StocktakeCountRequest = {
   countSheetLines: CountSheetLineUpsertRequest[];
};

export type StockAdjustmentCreateRequest = {
   productId: string;
   productBatchId: string;
   siteId: string;
   storageLocationId: string;
   adjustmentType: "Positive" | "Negative";
   quantity: number;
   reason: string;
   notes: string | null;
};

export type TransferOrderLineDetails = {
   id: string;
   transferOrderId: string;
   productId: string;
   productBatchId: string;
   requestedQuantity: number;
   shippedQuantity: number;
   receivedQuantity: number;
   notes: string | null;
};

export type TransferOrderDetails = {
   id: string;
   transferNumber: string;
   sourceSiteId: string;
   sourceStorageLocationId: string;
   destinationSiteId: string;
   destinationStorageLocationId: string;
   status: string;
   notes: string | null;
   createdByUserId: string | null;
   approvedByUserId: string | null;
   approvedAtUtc: string | null;
   shippedAtUtc: string | null;
   receivedAtUtc: string | null;
   createdAtUtc: string;
   updatedAtUtc: string;
   lines: TransferOrderLineDetails[];
};

export type TransferLineRequest = {
   productId: string;
   productBatchId: string;
   requestedQuantity: number;
   notes: string | null;
};

export type TransferCreateRequest = {
   sourceSiteId: string;
   sourceStorageLocationId: string;
   destinationSiteId: string;
   destinationStorageLocationId: string;
   notes: string | null;
   lines: TransferLineRequest[];
};

export type TransferShipLineRequest = {
   transferOrderLineId: string;
   shippedQuantity: number;
};

export type TransferShipRequest = {
   lines: TransferShipLineRequest[];
};

export type TransferReceiveLineRequest = {
   transferOrderLineId: string;
   receivedQuantity: number;
};

export type TransferReceiveRequest = {
   lines: TransferReceiveLineRequest[];
};

export type PrescriptionLineDetails = {
   id: string;
   prescriptionId: string;
   productId: string;
   productBatchId: string | null;
   prescribedQuantity: number;
   dispensedQuantity: number;
   dosage: string | null;
   frequency: string | null;
   duration: string | null;
   notes: string | null;
};

export type PrescriptionDetails = {
   id: string;
   prescriptionNumber: string;
   siteId: string;
   storageLocationId: string;
   patientName: string;
   patientPhone: string | null;
   doctorName: string | null;
   doctorLicense: string | null;
   status: string;
   notes: string | null;
   createdByUserId: string | null;
   cancelledByUserId: string | null;
   dispensedByUserId: string | null;
   dispensedAtUtc: string | null;
   createdAtUtc: string;
   updatedAtUtc: string;
   lines: PrescriptionLineDetails[];
};

export type PrescriptionLineCreateRequest = {
   productId: string;
   prescribedQuantity: number;
   dosage: string | null;
   frequency: string | null;
   duration: string | null;
   notes: string | null;
};

export type PrescriptionCreateRequest = {
   siteId: string;
   storageLocationId: string;
   patientName: string;
   patientPhone: string | null;
   doctorName: string | null;
   doctorLicense: string | null;
   notes: string | null;
   lines: PrescriptionLineCreateRequest[];
};

export type PrescriptionDispenseLineRequest = {
   prescriptionLineId: string;
   productBatchId: string;
   dispensedQuantity: number;
};

export type PrescriptionDispenseRequest = {
   lines: PrescriptionDispenseLineRequest[];
};

export type PrescriptionFilters = {
   siteId?: string;
   status?: string;
   limit?: number;
};

export type TransferFilters = {
   siteId?: string;
   status?: string;
   limit?: number;
};

export type StocktakeFilters = {
   siteId?: string;
   status?: string;
   limit?: number;
};

export type InventoryBalanceFilters = {
   productId?: string;
   siteId?: string;
   storageLocationId?: string;
   includeZeroBalances?: boolean;
};

export type StockLedgerFilters = {
   productId?: string;
   productBatchId?: string;
   siteId?: string;
   storageLocationId?: string;
   limit?: number;
};

export type AuditLogFilters = {
   userId?: string;
   siteId?: string;
   entityType?: string;
   entityId?: string;
   action?: string;
   limit?: number;
};

export type DashboardSummaryFilters = {
   siteId?: string;
};

export type ReturnCreateRequest = {
   productId: string;
   productBatchId: string;
   siteId: string;
   storageLocationId: string;
   quantity: number;
   reason: string;
   destination: string | null;
   occurredAtUtc: string | null;
   notes: string | null;
};

export type ManualMovementCreateRequest = {
   productId: string;
   productBatchId: string;
   siteId: string;
   storageLocationId: string;
   movementType: string;
   quantityDelta: number;
   occurredAtUtc: string | null;
   referenceType: string | null;
   referenceId: string | null;
   reason: string | null;
   notes: string | null;
};

let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

async function readErrorMessage(response: Response) {
   const contentType = response.headers.get("content-type") ?? "";

   if (contentType.includes("application/json") || contentType.includes("application/problem+json")) {
      const payload = (await response.json().catch(() => null)) as {
         error?: string;
         title?: string;
         detail?: string;
         errors?: Record<string, string[]>;
      } | null;

      if (payload !== null) {
         if (typeof payload.error === "string" && payload.error.trim()) {
            return payload.error;
         }

         if (typeof payload.detail === "string" && payload.detail.trim()) {
            return payload.detail;
         }

         if (typeof payload.title === "string" && payload.title.trim()) {
            return payload.title;
         }

         if (payload.errors !== undefined) {
            const firstEntry = Object.entries(payload.errors)[0];
            if (firstEntry !== undefined) {
               const [, messages] = firstEntry;
               if (messages.length > 0 && messages[0].trim()) {
                  return messages[0];
               }
            }
         }
      }

      return translate(getLanguage(), "errors.requestFailed", { status: response.status });
   }

   const text = await response.text();
   return text || translate(getLanguage(), "errors.requestFailed", { status: response.status });
}

function isUnsafeMethod(method: string) {
   return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

async function getCsrfToken() {
   if (csrfToken !== null) {
      return csrfToken;
   }

   if (csrfTokenPromise !== null) {
      return await csrfTokenPromise;
   }

   csrfTokenPromise = (async () => {
      const response = await fetch("/api/auth/csrf", {
         method: "GET",
         credentials: "include",
      });

      if (!response.ok) {
         throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as CsrfTokenResponse;
      csrfToken = payload.token;
      return payload.token;
   })();

   try {
      return await csrfTokenPromise;
   } finally {
      csrfTokenPromise = null;
   }
}

async function isCsrfTokenFailure(response: Response) {
   const contentType = response.headers.get("content-type") ?? "";
   if (!contentType.includes("application/json") && !contentType.includes("application/problem+json")) {
      return false;
   }

   const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: string; detail?: string; title?: string } | null;
   const message = payload?.error ?? payload?.detail ?? payload?.title;
   return message === "Invalid CSRF token.";
}

export function resetCsrfToken() {
   csrfToken = null;
}

async function fetchWithCsrfRetry(path: string, init: RequestInit, canRetry = true) {
   const response = await fetch(path, {
      ...init,
      credentials: "include",
   });

   const method = (init.method ?? "GET").toUpperCase();
   if (canRetry && isUnsafeMethod(method) && response.status === 403 && (await isCsrfTokenFailure(response))) {
      resetCsrfToken();
      return await fetchWithCsrfRetry(path, init, false);
   }

   return response;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
   const { headers: requestHeaders, method, ...requestInit } = init ?? {};
   const headers = new Headers(requestHeaders);
   headers.set("Content-Type", "application/json");

   if (isUnsafeMethod((method ?? "GET").toUpperCase())) {
      headers.set("X-CSRF-TOKEN", await getCsrfToken());
   }

   const response = await fetchWithCsrfRetry(path, {
      ...requestInit,
      method,
      headers,
   });

   if (!response.ok) {
      throw new Error(await readErrorMessage(response));
   }

   return (await response.json()) as T;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
   const { headers: requestHeaders, method, ...requestInit } = init ?? {};
   const headers = new Headers(requestHeaders);

   if (isUnsafeMethod((method ?? "GET").toUpperCase())) {
      headers.set("X-CSRF-TOKEN", await getCsrfToken());
   }

   const response = await fetchWithCsrfRetry(path, {
      ...requestInit,
      method,
      headers,
   });

   if (!response.ok) {
      throw new Error(await readErrorMessage(response));
   }
}

export async function loadSites() {
   return await requestJson<SiteDto[]>("/api/sites");
}

export async function loadStorageLocations() {
   return await requestJson<StorageLocationDto[]>("/api/storage-locations");
}

function buildStocktakeQuery(filters: StocktakeFilters = {}) {
   const query = new URLSearchParams();
   if (filters.siteId !== undefined && filters.siteId !== "") query.set("siteId", filters.siteId);
   if (filters.status !== undefined && filters.status !== "") query.set("status", filters.status);
   if (filters.limit !== undefined) query.set("limit", String(filters.limit));
   return query.size === 0 ? "" : `?${query}`;
}

function buildTransferQuery(filters: TransferFilters = {}) {
   const query = new URLSearchParams();
   if (filters.siteId !== undefined && filters.siteId !== "") query.set("siteId", filters.siteId);
   if (filters.status !== undefined && filters.status !== "") query.set("status", filters.status);
   if (filters.limit !== undefined) query.set("limit", String(filters.limit));
   return query.size === 0 ? "" : `?${query}`;
}

function buildAuditLogQuery(filters: AuditLogFilters = {}) {
   const query = new URLSearchParams();
   if (filters.userId !== undefined && filters.userId !== "") query.set("userId", filters.userId);
   if (filters.siteId !== undefined && filters.siteId !== "") query.set("siteId", filters.siteId);
   if (filters.entityType !== undefined && filters.entityType !== "") query.set("entityType", filters.entityType);
   if (filters.entityId !== undefined && filters.entityId !== "") query.set("entityId", filters.entityId);
   if (filters.action !== undefined && filters.action !== "") query.set("action", filters.action);
   if (filters.limit !== undefined) query.set("limit", String(filters.limit));
   return query.size === 0 ? "" : `?${query}`;
}

function buildDashboardSummaryQuery(filters: DashboardSummaryFilters = {}) {
   const query = new URLSearchParams();
   if (filters.siteId !== undefined && filters.siteId !== "") query.set("siteId", filters.siteId);
   return query.size === 0 ? "" : `?${query}`;
}

export async function loadProducts() {
   return await requestJson<ProductDto[]>("/api/products");
}

export async function loadSuppliers() {
   return await requestJson<SupplierDto[]>("/api/suppliers");
}

export async function loadGoodsReceipts() {
   return await requestJson<GoodsReceiptDto[]>("/api/goods-receipts");
}

export async function loadAuditLogs(filters: AuditLogFilters = {}) {
   return await requestJson<AuditLogEntryDto[]>(`/api/audit/logs${buildAuditLogQuery(filters)}`);
}

export async function loadDashboardSummary(filters: DashboardSummaryFilters = {}) {
   return await requestJson<DashboardSummaryDto>(`/api/dashboard/summary${buildDashboardSummaryQuery(filters)}`);
}

export async function createGoodsReceipt(request: GoodsReceiptUpsertRequest) {
   return await requestJson<GoodsReceiptDto>("/api/goods-receipts", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

function buildPrescriptionQuery(filters: PrescriptionFilters = {}) {
   const query = new URLSearchParams();
   if (filters.siteId !== undefined && filters.siteId !== "") query.set("siteId", filters.siteId);
   if (filters.status !== undefined && filters.status !== "") query.set("status", filters.status);
   if (filters.limit !== undefined) query.set("limit", String(filters.limit));
   return query.size === 0 ? "" : `?${query}`;
}

export async function loadPrescriptions(filters: PrescriptionFilters = {}) {
   return await requestJson<PrescriptionDetails[]>(`/api/prescriptions${buildPrescriptionQuery(filters)}`);
}

export async function loadPrescription(id: string) {
   return await requestJson<PrescriptionDetails>(`/api/prescriptions/${id}`);
}

export async function createPrescription(request: PrescriptionCreateRequest) {
   return await requestJson<PrescriptionDetails>("/api/prescriptions", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function dispensePrescription(id: string, request: PrescriptionDispenseRequest) {
   return await requestJson<PrescriptionDetails>(`/api/prescriptions/${id}/dispense`, {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function cancelPrescription(id: string) {
   return await requestJson<PrescriptionDetails>(`/api/prescriptions/${id}/cancel`, { method: "POST" });
}

export async function loadStocktakeSessions(filters: StocktakeFilters = {}) {
   return await requestJson<StocktakeSessionDetails[]>(`/api/stocktake-sessions${buildStocktakeQuery(filters)}`);
}

export async function createStocktakeSession(request: StocktakeSessionCreateRequest) {
   return await requestJson<StocktakeSessionDetails>("/api/stocktake-sessions", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function loadStocktakeSession(id: string) {
   return await requestJson<StocktakeSessionDetails>(`/api/stocktake-sessions/${id}`);
}

export async function recordStocktakeCount(id: string, request: StocktakeCountRequest) {
   return await requestJson<StocktakeSessionDetails>(`/api/stocktake-sessions/${id}/counts`, {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function postStocktakeAdjustments(id: string) {
   return await requestJson<StockAdjustmentDetails[]>(`/api/stocktake-sessions/${id}/adjustments`, { method: "POST" });
}

export async function loadStockAdjustments(filters: StocktakeFilters = {}) {
   return await requestJson<StockAdjustmentDetails[]>(`/api/stock-adjustments${buildStocktakeQuery(filters)}`);
}

export async function createStockAdjustment(request: StockAdjustmentCreateRequest) {
   return await requestJson<StockAdjustmentDetails>("/api/stock-adjustments", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function loadTransfers(filters: TransferFilters = {}) {
   return await requestJson<TransferOrderDetails[]>(`/api/transfers${buildTransferQuery(filters)}`);
}

export async function loadTransfer(id: string) {
   return await requestJson<TransferOrderDetails>(`/api/transfers/${id}`);
}

export async function createTransfer(request: TransferCreateRequest) {
   return await requestJson<TransferOrderDetails>("/api/transfers", { method: "POST", body: JSON.stringify(request) });
}

export async function approveTransfer(id: string) {
   return await requestJson<TransferOrderDetails>(`/api/transfers/${id}/approve`, { method: "POST" });
}

export async function shipTransfer(id: string, request: TransferShipRequest) {
   return await requestJson<TransferOrderDetails>(`/api/transfers/${id}/ship`, {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function receiveTransfer(id: string, request: TransferReceiveRequest) {
   return await requestJson<TransferOrderDetails>(`/api/transfers/${id}/receive`, {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function cancelTransfer(id: string) {
   return await requestJson<TransferOrderDetails>(`/api/transfers/${id}/cancel`, { method: "POST" });
}

export async function approveStockAdjustment(id: string, approvalNotes?: string) {
   return await requestJson<StockAdjustmentDetails>(`/api/stock-adjustments/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvalNotes: approvalNotes ?? null }),
   });
}

export async function createReturn(request: ReturnCreateRequest) {
   return await requestJson<StockLedgerEntryDto>("/api/returns", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function createInventoryMovement(request: ManualMovementCreateRequest) {
   return await requestJson<StockLedgerEntryDto>("/api/inventory/movements", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function loadStockLedgerEntries(filters: StockLedgerFilters = {}) {
   const query = new URLSearchParams();
   if (filters.productId !== undefined && filters.productId !== "") {
      query.set("productId", filters.productId);
   }

   if (filters.productBatchId !== undefined && filters.productBatchId !== "") {
      query.set("productBatchId", filters.productBatchId);
   }

   if (filters.siteId !== undefined && filters.siteId !== "") {
      query.set("siteId", filters.siteId);
   }

   if (filters.storageLocationId !== undefined && filters.storageLocationId !== "") {
      query.set("storageLocationId", filters.storageLocationId);
   }

   if (filters.limit !== undefined) {
      query.set("limit", String(filters.limit));
   }

   const path = query.size === 0 ? "/api/inventory/ledger" : `/api/inventory/ledger?${query}`;
   return await requestJson<StockLedgerEntryDto[]>(path);
}

export async function loadInventoryBalances(filters: InventoryBalanceFilters = {}) {
   const query = new URLSearchParams();
   if (filters.productId !== undefined && filters.productId !== "") {
      query.set("productId", filters.productId);
   }

   if (filters.siteId !== undefined && filters.siteId !== "") {
      query.set("siteId", filters.siteId);
   }

   if (filters.storageLocationId !== undefined && filters.storageLocationId !== "") {
      query.set("storageLocationId", filters.storageLocationId);
   }

   if (filters.includeZeroBalances !== undefined) {
      query.set("includeZeroBalances", String(filters.includeZeroBalances));
   }

   const path = query.size === 0 ? "/api/inventory/balances" : `/api/inventory/balances?${query}`;
   return await requestJson<InventoryBalanceDto[]>(path);
}

export async function loadPharmacyData() {
   const [sites, storageLocations] = await Promise.all([loadSites(), loadStorageLocations()]);
   return { sites, storageLocations };
}

export async function createSite(request: SiteUpsertRequest) {
   return await requestJson<SiteDto>("/api/sites", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function updateSite(id: string, request: SiteUpsertRequest) {
   return await requestJson<SiteDto>(`/api/sites/${id}`, {
      method: "PUT",
      body: JSON.stringify(request),
   });
}

export async function deleteSite(id: string) {
   await requestVoid(`/api/sites/${id}`, {
      method: "DELETE",
   });
}

export async function createStorageLocation(request: StorageLocationUpsertRequest) {
   return await requestJson<StorageLocationDto>("/api/storage-locations", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function updateStorageLocation(id: string, request: StorageLocationUpsertRequest) {
   return await requestJson<StorageLocationDto>(`/api/storage-locations/${id}`, {
      method: "PUT",
      body: JSON.stringify(request),
   });
}

export async function deleteStorageLocation(id: string) {
   await requestVoid(`/api/storage-locations/${id}`, {
      method: "DELETE",
   });
}

export async function createProduct(request: ProductUpsertRequest) {
   return await requestJson<ProductDto>("/api/products", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function updateProduct(id: string, request: ProductUpsertRequest) {
   return await requestJson<ProductDto>(`/api/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(request),
   });
}

export async function deleteProduct(id: string) {
   await requestVoid(`/api/products/${id}`, {
      method: "DELETE",
   });
}

export async function createSupplier(request: SupplierUpsertRequest) {
   return await requestJson<SupplierDto>("/api/suppliers", {
      method: "POST",
      body: JSON.stringify(request),
   });
}

export async function updateSupplier(id: string, request: SupplierUpsertRequest) {
   return await requestJson<SupplierDto>(`/api/suppliers/${id}`, {
      method: "PUT",
      body: JSON.stringify(request),
   });
}

export async function deleteSupplier(id: string) {
   await requestVoid(`/api/suppliers/${id}`, {
      method: "DELETE",
   });
}

export async function login(request: LoginRequest) {
   const user = await requestJson<AuthUserDetails>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(request),
   });

   resetCsrfToken();
   return user;
}

export async function logout() {
   await requestVoid("/api/auth/logout", {
      method: "POST",
   });

   resetCsrfToken();
}

export async function fetchMe() {
   return await requestJson<AuthUserDetails>("/api/auth/me");
}
