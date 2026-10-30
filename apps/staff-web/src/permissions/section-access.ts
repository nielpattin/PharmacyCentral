import type { Section } from "../router.ts";
import { hasStaffRole } from "./staff-permissions.ts";

/**
 * Which roles may open each sidebar section. This is the role-by-section table of
 * `docs/product/staff-shell-sign-in-and-navigation.md`, listed in table order. Platform Admin opens the read screens of
 * every operation and the four admin sections, and none of the work screens: the pharmacist overview and the imports.
 */
export const sectionRoles: Record<Section, readonly string[]> = {
  dashboard: ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"],
  analytics: ["Platform Admin", "Pharmacy Manager"],
  actionPlans: ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"],
  pharmacistOverview: ["Pharmacist"],
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
  importProducts: ["Pharmacy Manager"],
  importSites: ["Pharmacy Manager"],
  importLocations: ["Pharmacy Manager"],
  importSuppliers: ["Pharmacy Manager"],
  importStock: ["Warehouse Staff"],
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
