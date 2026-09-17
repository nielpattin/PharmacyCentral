import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { CheckoutPage } from "./pages/CheckoutPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import type { SortMode } from "./storefront/catalog.ts";

export type HomeSearch = {
  q?: string | undefined;
  "danh-muc"?: string | undefined;
  "sap-xep"?: SortMode | undefined;
  "nha-thuoc"?: string | undefined;
};

const SORT_MODES: SortMode[] = ["default", "price-asc", "price-desc", "name"];

const validateHomeSearch = (search: Record<string, unknown>): HomeSearch => {
  const sort = search["sap-xep"];
  return {
    q: typeof search.q === "string" ? search.q : undefined,
    "danh-muc": typeof search["danh-muc"] === "string" ? search["danh-muc"] : undefined,
    "sap-xep": SORT_MODES.includes(sort as SortMode) ? (sort as SortMode) : undefined,
    "nha-thuoc": typeof search["nha-thuoc"] === "string" ? search["nha-thuoc"] : undefined,
  };
};

const rootRoute = createRootRoute({ notFoundComponent: NotFoundPage });
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: validateHomeSearch,
  component: HomePage,
});
const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/don-hang",
  component: CheckoutPage,
});

const routeTree = rootRoute.addChildren([homeRoute, checkoutRoute]);

export const router = createRouter({
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
