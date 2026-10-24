import { z } from "zod";

// Read-only System page contracts: the service catalog (`GET /system/catalog`) and the gateway route table
// (`GET /system/routes`). Both are static data shipped inside this service.

export const routeAccessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("signed-in") }),
  z.object({ kind: z.literal("roles"), roles: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("platform-admin") }),
]);

export const routeRowSchema = z.object({
  /** Path pattern as the gateway sees it, with `/api` and a trailing `*` for a prefix. */
  path: z.string().regex(/^\/api\//),
  /** Present only for a row that matches one method, such as the product list. */
  method: z.literal("GET").optional(),
  service: z.string().min(1),
  access: routeAccessSchema,
  /** English sentence about an exception to the access above. The page translates it. */
  note: z.string().min(1).optional(),
});

export const routeTableSchema = z.object({
  routes: z.array(routeRowSchema),
});

export const serviceCatalogEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  /** The owned PostgreSQL database, or null for a service without one. */
  database: z.string().min(1).nullable(),
  /** Route patterns that the gateway sends to this service, in gateway order. */
  routePrefixes: z.array(z.string().min(1)),
  /** Services this one calls over HTTP. */
  dependsOn: z.array(z.string().min(1)),
  /** Services that call this one over HTTP, derived from every entry's `dependsOn`. */
  calledBy: z.array(z.string().min(1)),
  events: z.object({
    published: z.array(z.string().min(1)),
    consumed: z.array(z.string().min(1)),
  }),
});

export const serviceCatalogSchema = z.object({
  services: z.array(serviceCatalogEntrySchema),
});

export type RouteAccess = z.infer<typeof routeAccessSchema>;
export type RouteRow = z.infer<typeof routeRowSchema>;
export type RouteTable = z.infer<typeof routeTableSchema>;
export type ServiceCatalogEntry = z.infer<typeof serviceCatalogEntrySchema>;
export type ServiceCatalog = z.infer<typeof serviceCatalogSchema>;
