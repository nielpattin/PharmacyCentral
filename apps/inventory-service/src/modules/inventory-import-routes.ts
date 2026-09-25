import { Router } from "express";

import { openingBalanceImportSchema } from "../contracts/imports.ts";

import type { InventoryImportService } from "./inventory-import-service.ts";

export const createInventoryImportRouter = (importService: InventoryImportService | undefined): Router => {
  const router = Router();
  router.post("/inventory/imports/opening-balances", async (request, response) => {
    if (!importService)
      return response.status(503).json({ title: "Inventory database is not configured", status: 503 });
    const parsed = openingBalanceImportSchema.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({
        title: "Invalid import payload",
        status: 400,
        code: "invalid_import",
        errors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    try {
      const summary = await importService.importOpeningBalances(parsed.data);
      return response.json({ status: "imported", summary });
    } catch (error) {
      return response.status(409).json({
        title: error instanceof Error ? error.message : "Opening balance import failed",
        status: 409,
        code: "import_conflict",
      });
    }
  });
  return router;
};
