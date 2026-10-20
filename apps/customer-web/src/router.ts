import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { AccountPage } from "./pages/AccountPage.tsx";
import { RootLayout } from "./components/RootLayout.tsx";
import { CategoryPage } from "./pages/CategoryPage.tsx";
import { CheckoutPage } from "./pages/CheckoutPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { OrdersPage } from "./pages/OrdersPage.tsx";
import { PrescriptionIntakePage } from "./pages/PrescriptionIntakePage.tsx";
import { ProductDetailPage } from "./pages/ProductDetailPage.tsx";
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

const ACCOUNT_SECTIONS = ["tong-quan", "don-hang", "don-thuoc", "dia-chi", "ho-so", "mat-khau"] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

const validateAccountSearch = (search: Record<string, unknown>): { section: AccountSection } => {
  const section = search["section"];
  return { section: ACCOUNT_SECTIONS.includes(section as AccountSection) ? (section as AccountSection) : "tong-quan" };
};

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundPage });
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
const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/don-hang-cua-toi",
  component: OrdersPage,
});
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tai-khoan",
  validateSearch: validateAccountSearch,
  component: AccountPage,
});
const prescriptionIntakeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gui-don-thuoc",
  component: PrescriptionIntakePage,
});
const categoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/danh-muc/$slug",
  component: CategoryPage,
});
const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/san-pham/$productId",
  component: ProductDetailPage,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  categoryRoute,
  productRoute,
  checkoutRoute,
  ordersRoute,
  accountRoute,
  prescriptionIntakeRoute,
]);

export const router = createRouter({
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
