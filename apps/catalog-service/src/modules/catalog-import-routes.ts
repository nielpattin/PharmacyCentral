import { Router } from "express";

import { catalogImportSchema } from "../contracts/imports.ts";
import {
  ROLE_FORBIDDEN,
  refuse,
  requireEmployee,
  staffActorOf,
  type IdentityOptions,
} from "../shared/authorization/access.ts";
import { PHARMACY_MANAGER, PLATFORM_ADMIN } from "../shared/authorization/policy.ts";

import type { CatalogImportService } from "./catalog-import-service.ts";

export const createCatalogImportRouter = (
  importService: CatalogImportService | undefined,
  identity: IdentityOptions,
  onProductsChanged?: () => void | Promise<void>,
): Router => {
  const router = Router();
  // The route is shared: sites, storage locations and suppliers are Platform Admin's, products the Pharmacy Manager's.
  // Either role gets in; the payload then decides which one it needs.
  const importers = requireEmployee(identity, { roles: [PLATFORM_ADMIN, PHARMACY_MANAGER] });
  router.post("/products/imports", importers, async (request, response) => {
    if (!importService) return response.status(503).json({ title: "Catalog database is not configured", status: 503 });
    const parsed = catalogImportSchema.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({
        title: "Invalid import payload",
        status: 400,
        code: "invalid_import",
        errors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    const { roles } = staffActorOf(response);
    const data = parsed.data;
    const needsAdmin = data.sites.length + data.storageLocations.length + data.suppliers.length > 0;
    if ((needsAdmin && !roles.includes(PLATFORM_ADMIN)) || (data.products.length > 0 && !roles.includes(PHARMACY_MANAGER)))
      return refuse(response, ROLE_FORBIDDEN);
    try {
      const summary = await importService.import(parsed.data);
      await onProductsChanged?.();
      response.json({ status: "imported", summary });
    } catch (error) {
      response.status(409).json({
        title: error instanceof Error ? error.message : "Catalog import failed",
        status: 409,
        code: "import_conflict",
      });
    }
  });
  return router;
};
