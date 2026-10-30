import { Router } from "express";

import { openingBalanceImportSchema } from "../contracts/imports.ts";
import { actorSiteIds } from "../middleware/trusted-request.ts";

import { actorIdOf, allowRoles } from "./access-control.ts";
import { signCatalogIdentity } from "./catalog-identity.ts";
import { ImportSiteAccessError, type InventoryImportService } from "./inventory-import-service.ts";
import { today } from "./site-availability.ts";

export const createInventoryImportRouter = (importService: InventoryImportService | undefined): Router => {
  const router = Router();
  router.post("/inventory/imports/opening-balances", async (request, response) => {
    if (!importService)
      return response.status(503).json({ title: "Inventory database is not configured", status: 503 });
    // Opening stock is a Warehouse Staff record; Platform Admin reads inventory and never writes it.
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const parsed = openingBalanceImportSchema.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({
        title: "Invalid import payload",
        status: 400,
        code: "invalid_import",
        errors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    const currentDate = today();
    const expired = parsed.data.balances.flatMap((row, index) =>
      row.expiryDate > currentDate
        ? []
        : [{ path: `balances.${index}.expiryDate`, message: "Hạn sử dụng phải sau ngày hôm nay." }],
    );
    if (expired.length > 0)
      return response
        .status(400)
        .json({ title: "Invalid import payload", status: 400, code: "invalid_import", errors: expired });
    try {
      const summary = await importService.importOpeningBalances(parsed.data, {
        actorId: actorIdOf(request) ?? null,
        allowedSiteIds: actorSiteIds(request),
        catalogIdentity: () => signCatalogIdentity(request),
      });
      return response.json({ status: "imported", summary });
    } catch (error) {
      if (error instanceof ImportSiteAccessError)
        return response.status(403).json({
          title: "Site access denied",
          status: 403,
          code: "site_access_denied",
          detail: error.message,
        });
      return response.status(409).json({
        title: error instanceof Error ? error.message : "Opening balance import failed",
        status: 409,
        code: "import_conflict",
      });
    }
  });
  return router;
};
