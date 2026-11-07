import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { z } from "zod";

import { App } from "./App.tsx";
import { StaffNotFoundPage } from "./pages/NotFoundPage.tsx";

export type Section =
  | "dashboard"
  | "analytics"
  | "actionPlans"
  | "pharmacistOverview"
  | "prescriptions"
  | "orders"
  | "transfers"
  | "replenishment"
  | "sites"
  | "storageLocations"
  | "catalog"
  | "searchSynonyms"
  | "units"
  | "pricing"
  | "supplier"
  | "importProducts"
  | "importSites"
  | "importLocations"
  | "importSuppliers"
  | "importStock"
  | "receiving"
  | "procurement"
  | "stocktake"
  | "inventory"
  | "adjustments"
  | "returns"
  | "quality"
  | "finance"
  | "users"
  | "audit"
  | "aiIntegrations"
  | "system"
  | "account";

export const sectionPaths = {
  dashboard: "/",
  analytics: "/analytics",
  actionPlans: "/action-plans",
  pharmacistOverview: "/pharmacist-overview",
  prescriptions: "/prescriptions",
  orders: "/orders",
  transfers: "/transfers",
  replenishment: "/replenishment",
  sites: "/sites",
  storageLocations: "/storage-locations",
  catalog: "/catalog",
  searchSynonyms: "/search-synonyms",
  units: "/units",
  pricing: "/pricing",
  supplier: "/suppliers",
  importProducts: "/imports/products",
  importSites: "/imports/sites",
  importLocations: "/imports/storage-locations",
  importSuppliers: "/imports/suppliers",
  importStock: "/imports/stock",
  receiving: "/receiving",
  procurement: "/procurement",
  stocktake: "/stocktake",
  inventory: "/inventory",
  adjustments: "/adjustments",
  returns: "/returns",
  quality: "/quality",
  finance: "/finance",
  users: "/users",
  audit: "/audit",
  aiIntegrations: "/ai-integrations",
  system: "/system",
  account: "/account",
} as const satisfies Record<Section, string>;

export const governanceTabPaths = {
  audit: "/audit",
  users: "/users",
} as const;

export type StaffPath = (typeof sectionPaths)[Section];

const sectionsByPath: Record<string, Section> = {
  "/": "dashboard",
  "/analytics": "analytics",
  "/action-plans": "actionPlans",
  "/pharmacist-overview": "pharmacistOverview",
  "/prescriptions": "prescriptions",
  "/orders": "orders",
  "/transfers": "transfers",
  "/replenishment": "replenishment",
  "/sites": "sites",
  "/storage-locations": "storageLocations",
  "/catalog": "catalog",
  "/search-synonyms": "searchSynonyms",
  "/units": "units",
  "/pricing": "pricing",
  "/suppliers": "supplier",
  "/imports/products": "importProducts",
  "/imports/sites": "importSites",
  "/imports/storage-locations": "importLocations",
  "/imports/suppliers": "importSuppliers",
  "/imports/stock": "importStock",
  "/receiving": "receiving",
  "/procurement": "procurement",
  "/stocktake": "stocktake",
  "/inventory": "inventory",
  "/adjustments": "adjustments",
  "/returns": "returns",
  "/quality": "quality",
  "/finance": "finance",
  "/users": "users",
  "/audit": "audit",
  "/ai-integrations": "aiIntegrations",
  "/system": "system",
  "/account": "account",
};

export const pathForSection = (section: Section): StaffPath => sectionPaths[section];

export const sectionFromPath = (path: string): Section | undefined => sectionsByPath[path];

const rootRoute = createRootRoute({
  component: App,
  notFoundComponent: StaffNotFoundPage,
});

/**
 * Search params shared by every list screen. Each value is optional text; a value that fails its check is dropped
 * instead of failing the route. Pages read their own keys through hooks/useListUrlState.ts.
 */
export const listSearchSchema = z.looseObject({
  q: z.string().max(200).optional().catch(undefined),
  status: z.string().max(64).optional().catch(undefined),
  sort: z.string().max(64).optional().catch(undefined),
  tab: z.string().max(64).optional().catch(undefined),
});

export type ListSearch = z.infer<typeof listSearchSchema>;

const sectionRoute = <const TPath extends string>(path: TPath) =>
  createRoute({ getParentRoute: () => rootRoute, path, validateSearch: (search) => listSearchSchema.parse(search) });

const dashboardRoute = sectionRoute("/");
const analyticsRoute = sectionRoute("/analytics");
const actionPlansRoute = sectionRoute("/action-plans");
const pharmacistOverviewRoute = sectionRoute("/pharmacist-overview");
const prescriptionsRoute = sectionRoute("/prescriptions");
const ordersRoute = sectionRoute("/orders");
const transfersRoute = sectionRoute("/transfers");
const replenishmentRoute = sectionRoute("/replenishment");
const sitesRoute = sectionRoute("/sites");
const storageLocationsRoute = sectionRoute("/storage-locations");
const catalogRoute = sectionRoute("/catalog");
const searchSynonymsRoute = sectionRoute("/search-synonyms");
const unitsRoute = sectionRoute("/units");
const pricingRoute = sectionRoute("/pricing");
const supplierRoute = sectionRoute("/suppliers");
const importProductsRoute = sectionRoute("/imports/products");
const importSitesRoute = sectionRoute("/imports/sites");
const importLocationsRoute = sectionRoute("/imports/storage-locations");
const importSuppliersRoute = sectionRoute("/imports/suppliers");
const importStockRoute = sectionRoute("/imports/stock");
const receivingRoute = sectionRoute("/receiving");
const procurementRoute = sectionRoute("/procurement");
const stocktakeRoute = sectionRoute("/stocktake");
const inventoryRoute = sectionRoute("/inventory");
const adjustmentsRoute = sectionRoute("/adjustments");
const returnsRoute = sectionRoute("/returns");
const qualityRoute = sectionRoute("/quality");
const financeRoute = sectionRoute("/finance");
const usersRoute = sectionRoute("/users");
const auditRoute = sectionRoute("/audit");
const aiIntegrationsRoute = sectionRoute("/ai-integrations");
const systemRoute = sectionRoute("/system");
const accountRoute = sectionRoute("/account");

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  analyticsRoute,
  actionPlansRoute,
  pharmacistOverviewRoute,
  prescriptionsRoute,
  ordersRoute,
  transfersRoute,
  replenishmentRoute,
  sitesRoute,
  storageLocationsRoute,
  catalogRoute,
  searchSynonymsRoute,
  unitsRoute,
  pricingRoute,
  supplierRoute,
  importProductsRoute,
  importSitesRoute,
  importLocationsRoute,
  importSuppliersRoute,
  importStockRoute,
  receivingRoute,
  procurementRoute,
  stocktakeRoute,
  inventoryRoute,
  adjustmentsRoute,
  returnsRoute,
  qualityRoute,
  financeRoute,
  usersRoute,
  auditRoute,
  aiIntegrationsRoute,
  systemRoute,
  accountRoute,
]);

export const router = createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
