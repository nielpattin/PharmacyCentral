import { Router } from "express";

import { catalogImportSchema } from "../contracts/imports.ts";
import { requireEmployee, type IdentityOptions } from "../shared/authorization/access.ts";
import { ROLE_RULES } from "../shared/authorization/policy.ts";

import type { CatalogImportService } from "./catalog-import-service.ts";

export const createCatalogImportRouter = (
  importService: CatalogImportService | undefined,
  identity: IdentityOptions,
  onProductsChanged?: () => void | Promise<void>,
): Router => {
  const router = Router();
  const managers = requireEmployee(identity, ROLE_RULES.pharmacyManager);
  router.post("/products/imports", managers, async (request, response) => {
    if (!importService) return response.status(503).json({ title: "Catalog database is not configured", status: 503 });
    const parsed = catalogImportSchema.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({
        title: "Invalid import payload",
        status: 400,
        code: "invalid_import",
        errors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
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
