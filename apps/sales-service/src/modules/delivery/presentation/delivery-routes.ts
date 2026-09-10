import { Router } from "express";

import { deliveryCalculateRequestSchema } from "../../../contracts/sales.ts";

import type { DeliveryCalculator } from "../domain/delivery-calculator.ts";

export type StoreCoordinateLookup = (
  storeId: string,
) => Promise<{ id: string; latitude: number; longitude: number } | undefined>;

export const createDeliveryRouter = (
  calculator: DeliveryCalculator | undefined,
  lookupStore: StoreCoordinateLookup,
): Router => {
  const router = Router();

  router.post("/delivery/calculate", async (request, response) => {
    if (!calculator) {
      response
        .status(503)
        .json({ title: "Delivery provider is not configured", status: 503, code: "delivery_unavailable" });
      return;
    }

    const parsed = deliveryCalculateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid delivery request", status: 400, code: "invalid_request" });
      return;
    }
    const store = await lookupStore(parsed.data.selectedStoreId);
    if (!store) {
      response.status(404).json({ title: "Selected store not found", status: 404, code: "store_not_found" });
      return;
    }

    try {
      response.json(
        await calculator.calculate({
          store,
          destination: parsed.data.destination,
          addressNote: parsed.data.addressNote,
        }),
      );
    } catch (error) {
      response.status(502).json({
        title: error instanceof Error ? error.message : "Delivery provider failed",
        status: 502,
        code: "delivery_provider_failed",
      });
    }
  });

  return router;
};
