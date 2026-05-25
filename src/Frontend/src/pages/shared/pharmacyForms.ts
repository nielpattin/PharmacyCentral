import type {
   ProductDto,
   ProductUpsertRequest,
   SiteDto,
   SiteUpsertRequest,
   StorageLocationDto,
   StorageLocationUpsertRequest,
   SupplierDto,
   SupplierUpsertRequest,
} from "../../api/pharmacyClient";
import {
   normalizeSiteTypeValue,
   normalizeStorageLocationTypeValue,
   type SiteTypeValue,
   type StorageLocationTypeValue,
} from "./pharmacyTypes";
import { getLanguage, translate } from "../../lib/i18n";

export type SiteFormValues = Omit<SiteUpsertRequest, "siteType"> & {
   siteType: SiteTypeValue | "";
};

export type StorageLocationFormValues = Omit<StorageLocationUpsertRequest, "locationType" | "capacity"> & {
   locationType: StorageLocationTypeValue | "";
   capacity: string;
};

export type ProductFormValues = ProductUpsertRequest;

export type SupplierFormValues = SupplierUpsertRequest;

export function blankSiteValues(): SiteFormValues {
   return {
      code: "",
      name: "",
      siteType: "",
      status: "Active",
      address: "",
      notes: "",
      isActive: true,
   };
}

export function siteValuesFromDto(site: SiteDto): SiteFormValues {
   return {
      code: site.code,
      name: site.name,
      siteType: normalizeSiteTypeValue(site.siteType),
      status: site.status,
      address: site.address ?? "",
      notes: site.notes ?? "",
      isActive: site.isActive,
   };
}

export function blankStorageLocationValues(siteId: string): StorageLocationFormValues {
   return {
      siteId,
      code: "",
      name: "",
      locationType: "",
      status: "Active",
      capacity: "",
      isActive: true,
   };
}

export function storageLocationValuesFromDto(location: StorageLocationDto): StorageLocationFormValues {
   return {
      siteId: location.siteId,
      code: location.code,
      name: location.name,
      locationType: normalizeStorageLocationTypeValue(location.locationType),
      status: location.status,
      capacity: location.capacity === null ? "" : String(location.capacity),
      isActive: location.isActive,
   };
}

export function blankProductValues(): ProductFormValues {
   return {
      sku: "",
      name: "",
      category: "",
      unit: "",
      manufacturer: "",
      status: "Active",
      notes: "",
      isActive: true,
   };
}

export function productValuesFromDto(product: ProductDto): ProductFormValues {
   return {
      sku: product.sku,
      name: product.name,
      category: product.category ?? "",
      unit: product.unit ?? "",
      manufacturer: product.manufacturer ?? "",
      status: product.status,
      notes: product.notes ?? "",
      isActive: product.isActive,
   };
}

export function blankSupplierValues(): SupplierFormValues {
   return {
      code: "",
      name: "",
      contactName: "",
      email: "",
      phone: "",
      address: "",
      status: "Active",
      notes: "",
      isActive: true,
   };
}

export function supplierValuesFromDto(supplier: SupplierDto): SupplierFormValues {
   return {
      code: supplier.code,
      name: supplier.name,
      contactName: supplier.contactName ?? "",
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      address: supplier.address ?? "",
      status: supplier.status,
      notes: supplier.notes ?? "",
      isActive: supplier.isActive,
   };
}

export function areSiteFormValuesEqual(left: SiteFormValues, right: SiteFormValues) {
   return (
      left.code === right.code &&
      left.name === right.name &&
      left.siteType === right.siteType &&
      left.status === right.status &&
      left.address === right.address &&
      left.notes === right.notes &&
      left.isActive === right.isActive
   );
}

export function areStorageLocationFormValuesEqual(left: StorageLocationFormValues, right: StorageLocationFormValues) {
   return (
      left.siteId === right.siteId &&
      left.code === right.code &&
      left.name === right.name &&
      left.locationType === right.locationType &&
      left.status === right.status &&
      left.capacity === right.capacity &&
      left.isActive === right.isActive
   );
}

export function areProductFormValuesEqual(left: ProductFormValues, right: ProductFormValues) {
   return (
      left.sku === right.sku &&
      left.name === right.name &&
      left.category === right.category &&
      left.unit === right.unit &&
      left.manufacturer === right.manufacturer &&
      left.status === right.status &&
      left.notes === right.notes &&
      left.isActive === right.isActive
   );
}

export function areSupplierFormValuesEqual(left: SupplierFormValues, right: SupplierFormValues) {
   return (
      left.code === right.code &&
      left.name === right.name &&
      left.contactName === right.contactName &&
      left.email === right.email &&
      left.phone === right.phone &&
      left.address === right.address &&
      left.status === right.status &&
      left.notes === right.notes &&
      left.isActive === right.isActive
   );
}

export function normalizeText(value: string) {
   return value.trim();
}

export function parseCapacity(value: string) {
   if (!value.trim()) {
      return null;
   }

   const parsed = Number(value);
   if (Number.isNaN(parsed)) {
      throw new Error(translate(getLanguage(), "forms.capacityInvalid"));
   }

   return parsed;
}

export function formatValue(value: string | null | undefined) {
   return value?.trim() ? value : "—";
}

export function statusTone(status: string) {
   return status === "Active" ? "ok" : "bad";
}
