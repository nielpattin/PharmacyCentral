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
  | "catalog"
  | "supplier"
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
  catalog: "/catalog",
  supplier: "/suppliers",
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
  "/catalog": "catalog",
  "/suppliers": "supplier",
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
const catalogRoute = createRoute({ getParentRoute: () => rootRoute, path: "/catalog" });
const supplierRoute = createRoute({ getParentRoute: () => rootRoute, path: "/suppliers" });
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
  catalogRoute,
  supplierRoute,
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
