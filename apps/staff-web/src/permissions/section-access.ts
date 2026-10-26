import type { Section } from "../router.ts";
import { hasStaffRole } from "./staff-permissions.ts";

/**
 * Which roles may open each sidebar section. This is the role-by-section table of
 * `docs/product/staff-shell-sign-in-and-navigation.md`, listed in table order. Platform Admin is listed where the table
 * shows it; `canAccessSection` passes it for every section anyway, as every role rule does.
 */
export const sectionRoles: Record<Section, readonly string[]> = {
  dashboard: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  pharmacistOverview: ["Platform Admin", "Pharmacist"],
  prescriptions: ["Platform Admin", "Pharmacy Manager", "Pharmacist"],
  orders: ["Platform Admin", "Pharmacy Manager", "Pharmacist"],
  transfers: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  replenishment: ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"],
  procurement: ["Platform Admin", "Pharmacy Manager"],
  reporting: ["Platform Admin", "Pharmacy Manager"],
  finance: ["Platform Admin", "Pharmacy Manager"],
  sites: ["Platform Admin", "Pharmacy Manager"],
  storageLocations: ["Platform Admin", "Pharmacy Manager"],
  catalog: ["Platform Admin", "Pharmacy Manager"],
  searchSynonyms: ["Platform Admin", "Pharmacy Manager", "Pharmacist"],
  units: ["Platform Admin", "Pharmacy Manager"],
  pricing: ["Platform Admin", "Pharmacy Manager"],
  supplier: ["Platform Admin", "Pharmacy Manager"],
  importProducts: ["Platform Admin", "Pharmacy Manager"],
  importSites: ["Platform Admin", "Pharmacy Manager"],
  importLocations: ["Platform Admin", "Pharmacy Manager"],
  importSuppliers: ["Platform Admin", "Pharmacy Manager"],
  importStock: ["Platform Admin", "Warehouse Staff"],
  receiving: ["Platform Admin", "Warehouse Staff"],
  stocktake: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  inventory: ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"],
  adjustments: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  returns: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  quality: ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"],
  users: ["Platform Admin"],
  audit: ["Platform Admin"],
  aiIntegrations: ["Platform Admin"],
  system: ["Platform Admin"],
};

export const canAccessSection = (section: Section, roles: readonly string[]): boolean =>
  hasStaffRole(roles, sectionRoles[section]);
