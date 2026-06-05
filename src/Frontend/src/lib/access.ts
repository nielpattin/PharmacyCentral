import type { AuthUser } from "./auth";
import type { SidebarActiveKey } from "./sidebar";

export type RoleName = "Platform Admin" | "Pharmacy Manager" | "Pharmacist" | "Warehouse Staff";

export type NavItem = {
   key: SidebarActiveKey;
   href: string;
   label: string;
};

export type NavSection = {
   id: "operations" | "masterData" | "governance";
   label: string;
   items: NavItem[];
};

type RouteAccess = {
   path: string;
   active: SidebarActiveKey;
   roles: RoleName[];
};

const ALL_ROLES: RoleName[] = ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"];
const STORE_ROLES: RoleName[] = ["Platform Admin", "Pharmacy Manager", "Pharmacist"];
const MANAGEMENT_ROLES: RoleName[] = ["Platform Admin", "Pharmacy Manager"];
const WAREHOUSE_ROLES: RoleName[] = ["Platform Admin", "Warehouse Staff"];

export const ROUTE_ACCESS: RouteAccess[] = [
   { path: "/dashboard", active: "dashboard", roles: ALL_ROLES },
   { path: "/dashboard/prescriptions", active: "prescriptions", roles: STORE_ROLES },
   { path: "/dashboard/transfers", active: "transfers", roles: ALL_ROLES },
   { path: "/dashboard/sites", active: "sites", roles: MANAGEMENT_ROLES },
   { path: "/dashboard/catalog", active: "catalog", roles: MANAGEMENT_ROLES },
   { path: "/dashboard/pricing", active: "pricing", roles: MANAGEMENT_ROLES },
   { path: "/dashboard/supplier", active: "supplier", roles: MANAGEMENT_ROLES },
   { path: "/dashboard/receiving", active: "receiving", roles: WAREHOUSE_ROLES },
   { path: "/dashboard/procurement", active: "procurement", roles: MANAGEMENT_ROLES },
   { path: "/dashboard/stocktake", active: "stocktake", roles: WAREHOUSE_ROLES },
   { path: "/dashboard/inventory", active: "inventory", roles: ALL_ROLES },
   { path: "/dashboard/adjustments", active: "adjustments", roles: WAREHOUSE_ROLES },
   { path: "/dashboard/returns", active: "returns", roles: STORE_ROLES },
   { path: "/dashboard/quality", active: "quality", roles: WAREHOUSE_ROLES },
   { path: "/dashboard/recalls", active: "recalls", roles: MANAGEMENT_ROLES },
   { path: "/dashboard/reporting", active: "reporting", roles: MANAGEMENT_ROLES },
   { path: "/dashboard/audit", active: "audit", roles: ["Platform Admin"] },
   { path: "/dashboard/users", active: "users", roles: ["Platform Admin"] },
];

const STORAGE_LOCATIONS_PATH = /^\/dashboard\/sites\/[^/]+\/storage-locations$/;

function hasAnyRole(user: AuthUser, roles: RoleName[]) {
   return user.isPlatformAdmin || roles.some((role) => user.roles.includes(role));
}

export function canAccessPath(user: AuthUser, pathname: string) {
   if (STORAGE_LOCATIONS_PATH.test(pathname)) {
      return hasAnyRole(user, MANAGEMENT_ROLES);
   }

   const routeAccess = ROUTE_ACCESS.find((route) => route.path === pathname);
   if (routeAccess === undefined) {
      return true;
   }

   return hasAnyRole(user, routeAccess.roles);
}

export function filterNavSections(user: AuthUser | null, sections: NavSection[]) {
   if (user === null) {
      return [];
   }

   return sections
      .map((section) => ({
         ...section,
         items: section.items.filter((item) => canAccessPath(user, item.href)),
      }))
      .filter((section) => section.items.length > 0);
}
