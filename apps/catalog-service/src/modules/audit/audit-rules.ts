import type { AuditRule } from "./audit-middleware.ts";

const rule = (
  method: AuditRule["method"],
  route: string,
  entityType: string,
  action: AuditRule["action"],
  extra: Pick<AuditRule, "idParam" | "details"> = {},
): AuditRule => ({ method, route, entityType, action, ...extra });

/**
 * Every catalog write a person makes. The AI credential entry keeps the provider and model but never the key, because
 * only the listed body fields are stored.
 */
export const CATALOG_AUDIT_RULES: readonly AuditRule[] = [
  rule("POST", "/sites", "site", "catalog.site.created"),
  rule("PUT", "/sites/:id", "site", "catalog.site.updated"),
  rule("DELETE", "/sites/:id", "site", "catalog.site.deleted"),
  rule("POST", "/storage-locations", "storage-location", "catalog.storage-location.created"),
  rule("PUT", "/storage-locations/:id", "storage-location", "catalog.storage-location.updated"),
  rule("DELETE", "/storage-locations/:id", "storage-location", "catalog.storage-location.deleted"),
  rule("POST", "/suppliers", "supplier", "catalog.supplier.created"),
  rule("PUT", "/suppliers/:id", "supplier", "catalog.supplier.updated"),
  rule("DELETE", "/suppliers/:id", "supplier", "catalog.supplier.deleted"),
  rule("POST", "/products", "product", "catalog.product.created"),
  rule("PUT", "/products/:id", "product", "catalog.product.updated"),
  rule("DELETE", "/products/:id", "product", "catalog.product.deleted"),
  rule("PUT", "/products/:id/image", "product", "catalog.product.image-updated"),
  rule("POST", "/products/imports", "product-import", "catalog.products.imported"),
  rule("POST", "/products/:id/units", "product", "catalog.product-unit.created"),
  rule("PUT", "/products/:productId/units/:id", "product-unit", "catalog.product-unit.updated"),
  rule("DELETE", "/products/:productId/units/:id", "product-unit", "catalog.product-unit.deleted"),
  rule("POST", "/pricing/prices", "price", "catalog.price.created"),
  rule("POST", "/pricing/prices/:id/:action", "price", { prefix: "catalog.price", param: "action" }),
  rule("POST", "/products/search-synonyms", "search-synonym-group", "catalog.search-synonym.created"),
  rule("PUT", "/products/search-synonyms/:id", "search-synonym-group", "catalog.search-synonym.updated"),
  rule("POST", "/products/search-synonyms/:id/approve", "search-synonym-group", "catalog.search-synonym.approved"),
  rule("DELETE", "/products/search-synonyms/:id", "search-synonym-group", "catalog.search-synonym.deleted"),
  rule("PUT", "/products/search-credential", "ai-credential", "catalog.ai-credential.replaced", {
    details: ["provider", "model"],
  }),
  rule("DELETE", "/products/search-credential", "ai-credential", "catalog.ai-credential.cleared"),
];
