import { parseCsv } from "./csv.ts";
import type { JsonRecord } from "./staff-api.ts";

export type CsvRow = Record<string, string>;

export type ImportDatasetId = "catalog" | "sites" | "storageLocations" | "suppliers" | "openingBalances";

// How a dataset is read back after an import, so staff can verify the rows landed.
export type ImportVerification = {
  /** CSV column holding the value that identifies a row in the imported file. */
  keyColumn: string;
  /** Field carrying the same value on the record read back from the API. */
  key: string;
  /** Endpoint that returns the stored records. */
  listPath: string;
  /** False when the endpoint returns one page only, so a missing row cannot be proven. */
  complete: boolean;
  columns: Array<{ key: string; label: string }>;
  /** Nested API rows (inventory balances carry their batch) are flattened for display. */
  flatten?: (row: JsonRecord) => JsonRecord;
};

export type ImportDataset = {
  id: ImportDatasetId;
  label: string;
  fileBase: string;
  endpoint: string;
  columns: string[];
  fromCsv: (rows: CsvRow[]) => JsonRecord;
  verification: ImportVerification;
};

const textOrNull = (value: string | undefined): string | null => (value && value.trim() ? value.trim() : null);

const booleanOrUndefined = (value: string | undefined): boolean | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
};

const numberOrUndefined = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number but received ${JSON.stringify(value)}`);
  return parsed;
};

export const csvRows = (text: string): CsvRow[] => {
  const [headers, ...records] = parseCsv(text);
  if (!headers) throw new Error("CSV file is empty");
  const normalizedHeaders = headers.map((header) => header.trim());
  return records
    .filter((record) => record.some((value) => value.trim() !== ""))
    .map((record) =>
      Object.fromEntries(normalizedHeaders.map((header, index) => [header, record[index]?.trim() ?? ""])),
    );
};

const productPayload = (rows: CsvRow[]): JsonRecord => ({
  schemaVersion: 1,
  products: rows.map((row) => {
    const unitPrice = numberOrUndefined(row.unitPrice);
    return {
      sku: row.sku,
      name: row.name,
      barcode: textOrNull(row.barcode),
      genericName: textOrNull(row.genericName),
      activeIngredient: textOrNull(row.activeIngredient),
      indications: textOrNull(row.indications),
      strength: textOrNull(row.strength),
      dosageForm: textOrNull(row.dosageForm),
      packageDescription: textOrNull(row.packageDescription),
      registrationNumber: textOrNull(row.registrationNumber),
      prescriptionRequired: booleanOrUndefined(row.prescriptionRequired) ?? false,
      imageUrl: textOrNull(row.imageUrl),
      category: textOrNull(row.category),
      manufacturer: textOrNull(row.manufacturer),
      status: row.status || "Active",
      units: row.unitName
        ? [
            {
              unitName: row.unitName,
              conversionFactorToBaseUnit: 1,
              isBaseUnit: true,
              isDefaultSaleUnit: true,
              isDefaultPurchaseUnit: true,
              sortOrder: 0,
            },
          ]
        : [],
      price:
        unitPrice === undefined
          ? undefined
          : {
              unitPrice,
              currency: "VND",
              status: "Published",
              effectiveFrom: row.effectiveFrom,
            },
    };
  }),
});

const sitePayload = (rows: CsvRow[]): JsonRecord => ({
  schemaVersion: 1,
  sites: rows.map((row) => ({
    code: row.code,
    name: row.name,
    siteType: row.siteType || "RetailStore",
    status: row.status || "Active",
    address: textOrNull(row.address),
    isActive: booleanOrUndefined(row.isActive) ?? true,
    isCustomerFacing: booleanOrUndefined(row.isCustomerFacing) ?? false,
    latitude: numberOrUndefined(row.latitude) ?? null,
    longitude: numberOrUndefined(row.longitude) ?? null,
  })),
});

const storageLocationPayload = (rows: CsvRow[]): JsonRecord => ({
  schemaVersion: 1,
  storageLocations: rows.map((row) => ({
    siteCode: row.siteCode,
    code: row.code,
    name: row.name,
    locationType: row.locationType || "Warehouse",
    status: row.status || "Active",
    capacity: numberOrUndefined(row.capacity) ?? null,
    isActive: booleanOrUndefined(row.isActive) ?? true,
  })),
});

const supplierPayload = (rows: CsvRow[]): JsonRecord => ({
  schemaVersion: 1,
  suppliers: rows.map((row) => ({
    code: row.code,
    name: row.name,
    contactName: textOrNull(row.contactName),
    email: textOrNull(row.email),
    phone: textOrNull(row.phone),
    address: textOrNull(row.address),
    status: row.status || "Active",
    isActive: booleanOrUndefined(row.isActive) ?? true,
  })),
});

const openingBalancePayload = (rows: CsvRow[]): JsonRecord => ({
  schemaVersion: 1,
  balances: rows.map((row) => ({
    productSku: row.productSku,
    siteCode: row.siteCode,
    storageLocationCode: row.storageLocationCode,
    batchNumber: row.batchNumber,
    quantityOnHand: numberOrUndefined(row.quantityOnHand),
    expiryDate: row.expiryDate,
    manufacturedDate: textOrNull(row.manufacturedDate),
    manufacturer: textOrNull(row.manufacturer),
    supplierCode: textOrNull(row.supplierCode),
    qualityStatus: row.qualityStatus || "Released",
    reason: textOrNull(row.reason) ?? undefined,
  })),
});

const catalogDataset: ImportDataset = {
  id: "catalog",
  label: "Products and prices",
  fileBase: "products",
  endpoint: "/api/products/imports",
  columns: [
    "sku",
    "name",
    "category",
    "manufacturer",
    "genericName",
    "activeIngredient",
    "indications",
    "strength",
    "dosageForm",
    "packageDescription",
    "unitName",
    "unitPrice",
    "barcode",
    "registrationNumber",
    "prescriptionRequired",
    "imageUrl",
    "status",
    "effectiveFrom",
  ],
  verification: {
    keyColumn: "sku",
    key: "sku",
    // The product list is paged at 100 records, so an absent row is not proof of a failed import.
    listPath: "/api/products?limit=100",
    complete: false,
    columns: [
      { key: "sku", label: "SKU" },
      { key: "name", label: "Name" },
      { key: "category", label: "Category" },
      { key: "manufacturer", label: "Manufacturer" },
    ],
  },
  fromCsv: productPayload,
};

// Keyed by id: each page owns exactly one dataset, so the list order no longer matters.
export const datasets = {
  catalog: catalogDataset,
  sites: {
    id: "sites",
    label: "Sites",
    fileBase: "sites",
    endpoint: "/api/products/imports",
    columns: ["code", "name", "siteType", "address", "latitude", "longitude", "isCustomerFacing", "isActive", "status"],
    verification: {
      keyColumn: "code",
      key: "code",
      listPath: "/api/sites",
      complete: true,
      columns: [
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "siteType", label: "Type" },
        { key: "address", label: "Address" },
      ],
    },
    fromCsv: sitePayload,
  },
  storageLocations: {
    id: "storageLocations",
    label: "Storage locations",
    fileBase: "storage-locations",
    endpoint: "/api/products/imports",
    columns: ["siteCode", "code", "name", "locationType", "capacity", "isActive", "status"],
    verification: {
      keyColumn: "code",
      key: "code",
      listPath: "/api/storage-locations",
      complete: true,
      columns: [
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "siteId", label: "Site" },
        { key: "locationType", label: "Type" },
      ],
    },
    fromCsv: storageLocationPayload,
  },
  suppliers: {
    id: "suppliers",
    label: "Suppliers",
    fileBase: "suppliers",
    endpoint: "/api/products/imports",
    columns: ["code", "name", "contactName", "email", "phone", "address", "status", "isActive"],
    verification: {
      keyColumn: "code",
      key: "code",
      listPath: "/api/suppliers",
      complete: true,
      columns: [
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "contactName", label: "Contact" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
      ],
    },
    fromCsv: supplierPayload,
  },
  openingBalances: {
    id: "openingBalances",
    label: "Stock",
    fileBase: "opening-balances",
    endpoint: "/api/inventory/imports/opening-balances",
    columns: [
      "productSku",
      "siteCode",
      "storageLocationCode",
      "batchNumber",
      "quantityOnHand",
      "expiryDate",
      "manufacturedDate",
      "manufacturer",
      "supplierCode",
      "qualityStatus",
      "reason",
    ],
    verification: {
      keyColumn: "batchNumber",
      key: "batchNumber",
      listPath: "/api/inventory/balances",
      complete: true,
      columns: [
        { key: "batchNumber", label: "Batch" },
        { key: "productId", label: "Product" },
        { key: "storageLocationId", label: "Location" },
        { key: "quantityOnHand", label: "On hand" },
        { key: "expiryDate", label: "Expiry" },
        { key: "qualityStatus", label: "Quality" },
      ],
      flatten: (row) => ({
        ...(typeof row.balance === "object" && row.balance !== null ? row.balance : {}),
        ...(typeof row.batch === "object" && row.batch !== null ? row.batch : {}),
      }),
    },
    fromCsv: openingBalancePayload,
  },
} satisfies Record<ImportDatasetId, ImportDataset>;

// Templates carry structure only. Records come from the staff member or the
// supplier file, never from an asset shipped with the web app.
export const csvTemplate = ({ columns }: ImportDataset): string => `${columns.join(",")}\n`;

export const templateFileName = (dataset: ImportDataset): string => `${dataset.fileBase}.csv`;
