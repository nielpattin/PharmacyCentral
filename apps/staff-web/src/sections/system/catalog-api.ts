import { readOne } from "../../staff-api.ts";

// Mirrors the ops-console-service contracts: `GET /api/system/catalog` and `GET /api/system/routes`. Both answer
// constants of the service, so the page reads them once and keeps them while they are fresh.

export type SystemRouteAccess =
  | { kind: "public" }
  | { kind: "signed-in" }
  | { kind: "roles"; roles: string[] }
  | { kind: "platform-admin" };

export type SystemRouteRow = {
  path: string;
  method?: "GET";
  service: string;
  access: SystemRouteAccess;
  /** English sentence about an exception to the access. Translated where it is shown. */
  note?: string;
};

export type SystemRouteTable = { routes: SystemRouteRow[] };

export type SystemServiceEntry = {
  name: string;
  description: string;
  port: number;
  database: string | null;
  routePrefixes: string[];
  dependsOn: string[];
  calledBy: string[];
  events: { published: string[]; consumed: string[] };
};

export type SystemServiceCatalog = { services: SystemServiceEntry[] };

export const SYSTEM_CATALOG_QUERY_KEY = ["system-catalog"] as const;
export const SYSTEM_ROUTES_QUERY_KEY = ["system-routes"] as const;

export const readSystemCatalog = (): Promise<SystemServiceCatalog> =>
  readOne<SystemServiceCatalog>("/api/system/catalog");

export const readSystemRoutes = (): Promise<SystemRouteTable> => readOne<SystemRouteTable>("/api/system/routes");
