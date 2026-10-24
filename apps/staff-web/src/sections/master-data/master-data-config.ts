import type { JsonRecord } from "../../staff-api.ts";

// Sites, storage locations and suppliers share one screen. Each kind is described here; the screen itself is generic.
export type MasterDataKind = "sites" | "locations" | "suppliers";

// Form state keeps every value as a string, so inputs and selects bind directly. Booleans are "true" or "false".
export type RecordValues = Record<string, string>;

export type MasterField =
  | { kind: "text"; name: string; label: string; required?: boolean; type?: "text" | "email" }
  | { kind: "number"; name: string; label: string; min?: number; max?: number }
  | { kind: "boolean"; name: string; label: string }
  | { kind: "site"; name: string; label: string }
  /** A fixed set: `options` maps each stored value to its readable English label. */
  | { kind: "select"; name: string; label: string; options: Readonly<Record<string, string>> };

// Sites, storage locations and suppliers share these two statuses; the server only requires a string up to 30 characters.
const STATUS_LABELS = { Active: "Active", Inactive: "Inactive" } as const;

// The site types the catalog stores, with the label shown for each.
const SITE_TYPE_LABELS = {
  Headquarters: "Headquarters",
  RegionalHub: "Regional hub",
  RetailStore: "Retail store",
  Warehouse: "Warehouse",
} as const;

/** `valueLabels` maps a stored value to the readable English label shown in the table; the export keeps the stored value. */
export type MasterColumn = {
  key: string;
  label: string;
  truncate?: boolean;
  valueLabels?: Readonly<Record<string, string>>;
};

export type MasterDataConfig = {
  id: MasterDataKind;
  listPath: string;
  queryKey: readonly string[];
  /** The list needs the sites too: for the site picker and the site labels of each row. */
  usesSites: boolean;
  createLabel: string;
  editTitle: string;
  deleteTitle: string;
  created: string;
  updated: string;
  deleted: string;
  searchPlaceholder: string;
  columns: readonly MasterColumn[];
  fields: readonly MasterField[];
  initialValues: () => RecordValues;
  valuesFromRow: (row: JsonRecord) => RecordValues;
  toBody: (values: RecordValues) => JsonRecord;
  /** Typed to confirm a delete: the code the staff member sees in the list. */
  codeOf: (row: JsonRecord) => string;
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

const flag = (value: unknown, fallback: boolean): string =>
  typeof value === "boolean" ? String(value) : String(fallback);

// Empty optional text is sent as null, so clearing a field clears it on the server.
const optionalText = (value: string): string | null => (value.trim() === "" ? null : value.trim());

const optionalNumber = (value: string): number | null => (value.trim() === "" ? null : Number(value));

export const sameValues = (left: RecordValues, right: RecordValues): boolean => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
};

const siteConfig: MasterDataConfig = {
  id: "sites",
  listPath: "/api/sites",
  queryKey: ["master-data", "sites"],
  usesSites: false,
  createLabel: "Create site",
  editTitle: "Edit site",
  deleteTitle: "Delete site?",
  created: "Site created.",
  updated: "Site updated.",
  deleted: "Site deleted.",
  searchPlaceholder: "Search by code or name",
  columns: [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
    {
      key: "siteType",
      label: "Type",
      valueLabels: SITE_TYPE_LABELS,
    },
    { key: "address", label: "Address" },
    { key: "status", label: "Status" },
  ],
  fields: [
    { kind: "text", name: "code", label: "Code", required: true },
    { kind: "text", name: "name", label: "Name", required: true },
    { kind: "select", name: "siteType", label: "Site type", options: SITE_TYPE_LABELS },
    { kind: "select", name: "status", label: "Status", options: STATUS_LABELS },
    { kind: "text", name: "address", label: "Address" },
    { kind: "text", name: "notes", label: "Notes" },
    { kind: "boolean", name: "isActive", label: "Active" },
    { kind: "boolean", name: "isCustomerFacing", label: "Customer facing" },
    { kind: "number", name: "latitude", label: "Latitude", min: -90, max: 90 },
    { kind: "number", name: "longitude", label: "Longitude", min: -180, max: 180 },
  ],
  initialValues: () => ({
    code: "",
    name: "",
    siteType: "RetailStore",
    status: "Active",
    address: "",
    notes: "",
    isActive: "true",
    isCustomerFacing: "true",
    latitude: "",
    longitude: "",
  }),
  valuesFromRow: (row) => ({
    code: text(row.code),
    name: text(row.name),
    siteType: text(row.siteType),
    status: text(row.status) || "Active",
    address: text(row.address),
    notes: text(row.notes),
    isActive: flag(row.isActive, true),
    isCustomerFacing: flag(row.isCustomerFacing, true),
    latitude: text(row.latitude),
    longitude: text(row.longitude),
  }),
  toBody: (values) => ({
    code: values.code,
    name: values.name,
    siteType: values.siteType,
    status: values.status,
    address: optionalText(values.address ?? ""),
    notes: optionalText(values.notes ?? ""),
    isActive: values.isActive === "true",
    isCustomerFacing: values.isCustomerFacing === "true",
    latitude: optionalNumber(values.latitude ?? ""),
    longitude: optionalNumber(values.longitude ?? ""),
  }),
  codeOf: (row) => text(row.code),
};

const locationConfig: MasterDataConfig = {
  id: "locations",
  listPath: "/api/storage-locations",
  queryKey: ["master-data", "locations"],
  usesSites: true,
  createLabel: "Create storage location",
  editTitle: "Edit storage location",
  deleteTitle: "Delete storage location?",
  created: "Storage location created.",
  updated: "Storage location updated.",
  deleted: "Storage location deleted.",
  searchPlaceholder: "Search by code or name",
  columns: [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
    { key: "siteId", label: "Site" },
    { key: "locationType", label: "Type" },
    { key: "status", label: "Status" },
  ],
  fields: [
    { kind: "site", name: "siteId", label: "Site" },
    { kind: "text", name: "code", label: "Code", required: true },
    { kind: "text", name: "name", label: "Name", required: true },
    { kind: "text", name: "locationType", label: "Location type", required: true },
    { kind: "select", name: "status", label: "Status", options: STATUS_LABELS },
    { kind: "number", name: "capacity", label: "Capacity", min: 0 },
    { kind: "boolean", name: "isActive", label: "Active" },
  ],
  initialValues: () => ({
    siteId: "",
    code: "",
    name: "",
    locationType: "Warehouse",
    status: "Active",
    capacity: "",
    isActive: "true",
  }),
  valuesFromRow: (row) => ({
    siteId: text(row.siteId),
    code: text(row.code),
    name: text(row.name),
    locationType: text(row.locationType) || "Warehouse",
    status: text(row.status) || "Active",
    capacity: text(row.capacity),
    isActive: flag(row.isActive, true),
  }),
  toBody: (values) => ({
    siteId: values.siteId,
    code: values.code,
    name: values.name,
    locationType: values.locationType,
    status: values.status,
    capacity: optionalNumber(values.capacity ?? ""),
    isActive: values.isActive === "true",
  }),
  codeOf: (row) => text(row.code),
};

const supplierConfig: MasterDataConfig = {
  id: "suppliers",
  listPath: "/api/suppliers",
  queryKey: ["master-data", "suppliers"],
  usesSites: false,
  createLabel: "Create supplier",
  editTitle: "Edit supplier",
  deleteTitle: "Delete supplier?",
  created: "Supplier created.",
  updated: "Supplier updated.",
  deleted: "Supplier deleted.",
  searchPlaceholder: "Search by code or name",
  columns: [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
    { key: "contactName", label: "Contact" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
  ],
  fields: [
    { kind: "text", name: "code", label: "Code", required: true },
    { kind: "text", name: "name", label: "Name", required: true },
    { kind: "text", name: "contactName", label: "Contact name" },
    { kind: "text", name: "email", label: "Email", type: "email" },
    { kind: "text", name: "phone", label: "Phone" },
    { kind: "text", name: "address", label: "Address" },
    { kind: "select", name: "status", label: "Status", options: STATUS_LABELS },
    { kind: "text", name: "notes", label: "Notes" },
    { kind: "boolean", name: "isActive", label: "Active" },
  ],
  initialValues: () => ({
    code: "",
    name: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    status: "Active",
    notes: "",
    isActive: "true",
  }),
  valuesFromRow: (row) => ({
    code: text(row.code),
    name: text(row.name),
    contactName: text(row.contactName),
    email: text(row.email),
    phone: text(row.phone),
    address: text(row.address),
    status: text(row.status) || "Active",
    notes: text(row.notes),
    isActive: flag(row.isActive, true),
  }),
  toBody: (values) => ({
    code: values.code,
    name: values.name,
    contactName: optionalText(values.contactName ?? ""),
    email: optionalText(values.email ?? ""),
    phone: optionalText(values.phone ?? ""),
    address: optionalText(values.address ?? ""),
    status: values.status,
    notes: optionalText(values.notes ?? ""),
    isActive: values.isActive === "true",
  }),
  codeOf: (row) => text(row.code),
};

export const masterDataConfigs: Record<MasterDataKind, MasterDataConfig> = {
  sites: siteConfig,
  locations: locationConfig,
  suppliers: supplierConfig,
};
