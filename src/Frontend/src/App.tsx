import { useCallback, type MouseEvent, type ReactNode } from "react";
import { Breadcrumbs } from "./components/layout/Breadcrumbs";
import { useT } from "./lib/i18n";
import { navigate, usePathname } from "./lib/router";
import { getPostLoginRedirectPath, isProtectedPath, setPostLoginRedirectPath, useAuth } from "./lib/auth";
import type { SidebarActiveKey } from "./lib/sidebar";
import DashboardPage from "./pages/DashboardPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import OperationPlaceholderPage from "./pages/OperationPlaceholderPage";
import SitesPage from "./pages/SitesPage";
import StorageLocationsPage from "./pages/StorageLocationsPage";

const PLACEHOLDER_ROUTES: Array<{
   path: string;
   active: SidebarActiveKey;
   titleKey: string;
}> = [
   { path: "/dashboard/prescriptions", active: "prescriptions", titleKey: "nav.prescription" },
   { path: "/dashboard/transfers", active: "transfers", titleKey: "nav.transfer" },
   { path: "/dashboard/catalog", active: "catalog", titleKey: "nav.catalog" },
   { path: "/dashboard/supplier", active: "supplier", titleKey: "nav.supplier" },
   { path: "/dashboard/receiving", active: "receiving", titleKey: "nav.receiving" },
   { path: "/dashboard/inventory", active: "inventory", titleKey: "nav.inventory" },
   { path: "/dashboard/returns", active: "returns", titleKey: "nav.returns" },
   { path: "/dashboard/reporting", active: "reporting", titleKey: "nav.reporting" },
   { path: "/dashboard/audit", active: "audit", titleKey: "nav.audit" },
];

const STORAGE_LOCATIONS_PATH = /^\/dashboard\/sites\/([^/]+)\/storage-locations$/;

function normalizePathname(pathname: string) {
   if (pathname.length > 1 && pathname.endsWith("/")) {
      return pathname.slice(0, -1);
   }

   return pathname;
}

function resolveRoutePathname(pathname: string, isAuthenticated: boolean) {
   if (isProtectedPath(pathname) && !isAuthenticated) {
      setPostLoginRedirectPath(pathname);
      return "/login";
   }

   if (pathname === "/login" && isAuthenticated) {
      return getPostLoginRedirectPath();
   }

   return pathname;
}

export default function App() {
   const t = useT();
   const pathname = normalizePathname(usePathname());
   const authUser = useAuth();
   const isAuthenticated = authUser !== null;

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

   const routePathname = resolveRoutePathname(pathname, isAuthenticated);

   if (pathname !== routePathname) {
      navigate(routePathname);
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
