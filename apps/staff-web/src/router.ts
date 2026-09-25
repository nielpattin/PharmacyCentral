import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { App } from "./App.tsx";
import { StaffNotFoundPage } from "./pages/NotFoundPage.tsx";
export type Section =
  | "dashboard"
  | "pharmacistOverview"
  | "prescriptions"
  | "transfers"
  | "replenishment"
  | "sites"
  | "storageLocations"
  | "catalog"
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
  | "reporting"
  | "finance"
  | "users"
  | "audit";

export const sectionPaths = {
  dashboard: "/",
  pharmacistOverview: "/pharmacist-overview",
  prescriptions: "/prescriptions",
  transfers: "/transfers",
  replenishment: "/replenishment",
  sites: "/sites",
  storageLocations: "/storage-locations",
  catalog: "/catalog",
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
  reporting: "/reporting",
  finance: "/finance",
  users: "/users",
  audit: "/audit",
} as const satisfies Record<Section, string>;

export const governanceTabPaths = {
  audit: "/audit",
  users: "/users",
  createUser: "/users/create",
  editAccess: "/users/access",
} as const;

export type GovernancePath = (typeof governanceTabPaths)[keyof typeof governanceTabPaths];

export type StaffPath = (typeof sectionPaths)[Section];

const sectionsByPath: Record<string, Section> = {
  "/": "dashboard",
  "/pharmacist-overview": "pharmacistOverview",
  "/prescriptions": "prescriptions",
  "/transfers": "transfers",
  "/replenishment": "replenishment",
  "/sites": "sites",
  "/storage-locations": "storageLocations",
  "/catalog": "catalog",
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
  "/reporting": "reporting",
  "/finance": "finance",
  "/users": "users",
  "/users/create": "users",
  "/users/access": "users",
  "/audit": "audit",
};

export const pathForSection = (section: Section): StaffPath => sectionPaths[section];

export const sectionFromPath = (path: string): Section | undefined => sectionsByPath[path];

const rootRoute = createRootRoute({
  component: App,
  notFoundComponent: StaffNotFoundPage,
});

const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const pharmacistOverviewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/pharmacist-overview" });
const prescriptionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/prescriptions" });
const transfersRoute = createRoute({ getParentRoute: () => rootRoute, path: "/transfers" });
const replenishmentRoute = createRoute({ getParentRoute: () => rootRoute, path: "/replenishment" });
const sitesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sites" });
const storageLocationsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/storage-locations" });
const catalogRoute = createRoute({ getParentRoute: () => rootRoute, path: "/catalog" });
const unitsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/units" });
const pricingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/pricing" });
const supplierRoute = createRoute({ getParentRoute: () => rootRoute, path: "/suppliers" });
const importProductsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/imports/products" });
const importSitesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/imports/sites" });
const importLocationsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/imports/storage-locations" });
const importSuppliersRoute = createRoute({ getParentRoute: () => rootRoute, path: "/imports/suppliers" });
const importStockRoute = createRoute({ getParentRoute: () => rootRoute, path: "/imports/stock" });
const receivingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/receiving" });
const procurementRoute = createRoute({ getParentRoute: () => rootRoute, path: "/procurement" });
const stocktakeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/stocktake" });
const inventoryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/inventory" });
const adjustmentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/adjustments" });
const returnsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/returns" });
const qualityRoute = createRoute({ getParentRoute: () => rootRoute, path: "/quality" });
const reportingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/reporting" });
const financeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/finance" });
const usersRoute = createRoute({ getParentRoute: () => rootRoute, path: "/users" });
const auditRoute = createRoute({ getParentRoute: () => rootRoute, path: "/audit" });

const createUserRoute = createRoute({ getParentRoute: () => rootRoute, path: "/users/create" });
const editAccessRoute = createRoute({ getParentRoute: () => rootRoute, path: "/users/access" });

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  pharmacistOverviewRoute,
  prescriptionsRoute,
  transfersRoute,
  replenishmentRoute,
  sitesRoute,
  storageLocationsRoute,
  catalogRoute,
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
  reportingRoute,
  financeRoute,
  usersRoute,
  createUserRoute,
  editAccessRoute,
  auditRoute,
]);

export const router = createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
