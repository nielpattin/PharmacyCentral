import { useCallback, type MouseEvent, type ReactNode } from "react";
import { Breadcrumbs } from "./components/layout/Breadcrumbs";
import { useMountEffect } from "./hooks/useMountEffect";
import { useT } from "./lib/i18n";
import { navigate, usePathname } from "./lib/router";
import {
   getPostLoginRedirectPath,
   initializeAuth,
   isProtectedPath,
   useAuth,
   useAuthLoading,
   type AuthUser,
} from "./lib/auth";
import { canAccessPath } from "./lib/access";
import type { SidebarActiveKey } from "./lib/sidebar";
import AuditPage from "./pages/AuditPage";
import DashboardPage from "./pages/DashboardPage";
import StocktakePage from "./pages/StocktakePage";
import StockAdjustmentPage from "./pages/StockAdjustmentPage";
import TransferPage from "./pages/TransferPage";
import PrescriptionPage from "./pages/PrescriptionPage";
import ReportingPage from "./pages/ReportingPage";
import ReturnsPage from "./pages/ReturnsPage";
import UserManagementPage from "./pages/UserManagementPage";
import QualityPage from "./pages/QualityPage";
import RecallPage from "./pages/RecallPage";

import GoodsReceiptsPage from "./pages/GoodsReceiptsPage";
import InventoryPage from "./pages/InventoryPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import OperationPlaceholderPage from "./pages/OperationPlaceholderPage";
import ProductsPage from "./pages/ProductsPage";
import SitesPage from "./pages/SitesPage";
import StorageLocationsPage from "./pages/StorageLocationsPage";
import SuppliersPage from "./pages/SuppliersPage";

const PLACEHOLDER_ROUTES: Array<{
   path: string;
   active: SidebarActiveKey;
   titleKey: string;
}> = [
   { path: "/dashboard/prescriptions", active: "prescriptions", titleKey: "nav.prescription" },
];

const STORAGE_LOCATIONS_PATH = /^\/dashboard\/sites\/([^/]+)\/storage-locations$/;

function normalizePathname(pathname: string) {
   if (pathname.length > 1 && pathname.endsWith("/")) {
      return pathname.slice(0, -1);
   }

   return pathname;
}

function resolveRoutePathname(pathname: string, authUser: AuthUser | null) {
   if (isProtectedPath(pathname) && authUser === null) {
      return "/login";
   }

   if (pathname === "/login" && authUser !== null) {
      return getPostLoginRedirectPath();
   }

   if (isProtectedPath(pathname) && authUser !== null && !canAccessPath(authUser, pathname)) {
      return "/dashboard";
   }

   return pathname;
}

function RouteRedirect({ to }: { to: string }) {
   useMountEffect(() => {
      navigate(to);
   });

   return null;
}

export default function App() {
   const t = useT();
   const pathname = normalizePathname(usePathname());
   const authUser = useAuth();
   const isAuthLoading = useAuthLoading();

   useMountEffect(() => {
      void initializeAuth();
   });

   const handleRootClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
      const link = (event.target as HTMLElement).closest("a");
      if (link === null) {
         return;
      }

      const href = link.getAttribute("href");
      if (
         href === null ||
         !href.startsWith("/") ||
         href.startsWith("//") ||
         link.hasAttribute("download") ||
         link.hasAttribute("target")
      ) {
         return;
      }

      event.preventDefault();
      navigate(href);
   }, []);

   const routePathname = isAuthLoading ? pathname : resolveRoutePathname(pathname, authUser);

   if (!isAuthLoading && pathname !== routePathname) {
      return <RouteRedirect to={routePathname} />;
   }

   if (isAuthLoading) {
      return (
         <main className="login-page">
            <section className="login-card card">
               <div className="section" style={{ textAlign: "center", padding: "48px 24px" }}>
                  <p>{t("common.loading")}</p>
               </div>
            </section>
         </main>
      );
   }

   let page: ReactNode;

   switch (routePathname) {
      case "/":
         page = <LandingPage />;
         break;
      case "/login":
         page = <LoginPage />;
         break;
      case "/dashboard":
         page = <DashboardPage />;
         break;
      case "/dashboard/sites":
         page = <SitesPage />;
         break;
      case "/dashboard/catalog":
         page = <ProductsPage />;
         break;
      case "/dashboard/supplier":
         page = <SuppliersPage />;
         break;
      case "/dashboard/receiving":
         page = <GoodsReceiptsPage />;
         break;
      case "/dashboard/stocktake":
         page = <StocktakePage />;
         break;
      case "/dashboard/transfers":
         page = <TransferPage />;
         break;
      case "/dashboard/prescriptions":
         page = <PrescriptionPage />;
         break;

      case "/dashboard/inventory":
         page = <InventoryPage />;
         break;
      case "/dashboard/adjustments":
         page = <StockAdjustmentPage />;
         break;
      case "/dashboard/audit":
         page = <AuditPage />;
         break;
      case "/dashboard/users":
         page = <UserManagementPage />;
         break;
      case "/dashboard/reporting":
         page = <ReportingPage />;
         break;
      case "/dashboard/returns":
         page = <ReturnsPage />;
         break;
      case "/dashboard/quality":
         page = <QualityPage />;
         break;
      case "/dashboard/recalls":
         page = <RecallPage />;
         break;
      default: {
         const storageLocationMatch = routePathname.match(STORAGE_LOCATIONS_PATH);
         if (storageLocationMatch !== null) {
            page = <StorageLocationsPage siteId={decodeURIComponent(storageLocationMatch[1])} />;
            break;
         }

         const placeholderRoute = PLACEHOLDER_ROUTES.find((route) => route.path === routePathname);
         if (placeholderRoute === undefined) {
            page = <NotFoundPage />;
            break;
         }

         const title = t(placeholderRoute.titleKey);
         const breadcrumb = <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: title }]} />;

         page = <OperationPlaceholderPage active={placeholderRoute.active} title={title} breadcrumb={breadcrumb} />;
      }
   }

   return <div onClick={handleRootClick}>{page}</div>;
}
