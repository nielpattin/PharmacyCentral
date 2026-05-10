export const siteTypeOptions = ["HeadOffice", "Warehouse", "RegionalHub", "RetailStore"] as const;
export const storageLocationTypeOptions = ["Receiving", "Storage", "Picking", "Dispatch", "Service", "Office"] as const;

export type SiteTypeValue = (typeof siteTypeOptions)[number];
export type StorageLocationTypeValue = (typeof storageLocationTypeOptions)[number];

export type Translator = (key: string) => string;

export function siteTypeLabel(value: string, t: Translator) {
   switch (normalizeSiteTypeValue(value)) {
      case "HeadOffice":
         return t("types.site.headOffice");
      case "Warehouse":
         return t("types.site.warehouse");
      case "RegionalHub":
         return t("types.site.regionalHub");
      case "RetailStore":
         return t("types.site.retailStore");
      default:
         return value;
   }
}

export function normalizeSiteTypeValue(value: string): SiteTypeValue | "" {
   switch (value) {
      case "HeadOffice":
      case "Head Office":
         return "HeadOffice";
      case "Warehouse":
         return "Warehouse";
      case "RegionalHub":
      case "Regional Hub":
         return "RegionalHub";
      case "RetailStore":
      case "Retail Store":
         return "RetailStore";
      default:
         return "";
   }
}

export function storageLocationTypeLabel(value: string, t: Translator) {
   switch (normalizeStorageLocationTypeValue(value)) {
      case "Receiving":
         return t("types.location.receiving");
      case "Storage":
         return t("types.location.storage");
      case "Picking":
         return t("types.location.picking");
      case "Dispatch":
         return t("types.location.dispatch");
      case "Service":
         return t("types.location.service");
      case "Office":
         return t("types.location.office");
      default:
         return value;
   }
}

export function normalizeStorageLocationTypeValue(value: string): StorageLocationTypeValue | "" {
   switch (value) {
      case "Receiving":
         return "Receiving";
      case "Storage":
         return "Storage";
      case "Picking":
         return "Picking";
      case "Dispatch":
         return "Dispatch";
      case "Service":
         return "Service";
      case "Office":
         return "Office";
      default:
         return "";
   }
}
