import { Router } from "express";

import {
  addressResolveRequestSchema,
  addressSearchQuerySchema,
  deliveryCalculateRequestSchema,
  reverseGeocodeRequestSchema,
} from "../../../contracts/sales.ts";

import type { AddressGeocoder, AddressSearch, DeliveryCalculator } from "../domain/delivery-calculator.ts";

export type StoreCoordinateLookup = (
  storeId: string,
) => Promise<{ id: string; latitude: number; longitude: number } | undefined>;

export const createDeliveryRouter = (
  calculator: DeliveryCalculator | undefined,
  lookupStore: StoreCoordinateLookup,
  addresses: AddressGeocoder & AddressSearch,
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

  /**
   * A dragged pin has no address text of its own, and a geocoder's answer belongs to the old point the moment
   * the shopper moves it. The map asks here so the label under it always describes where the pin actually is.
   * No store is involved: this is one coordinate in, one label out. The pin stays the truth; this only names it.
   */
  router.post("/delivery/reverse-geocode", async (request, response) => {
    const parsed = reverseGeocodeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid delivery request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      response.json({
        destination: parsed.data.destination,
        providerResolvedAddress: await addresses.resolveAddress(parsed.data.destination),
      });
    } catch (error) {
      response.status(502).json({
        title: error instanceof Error ? error.message : "Delivery provider failed",
        status: 502,
        code: "delivery_provider_failed",
      });
    }
  });

  /**
   * Suggests addresses for what the shopper typed. The browser never sees the Vietmap key: it sends the text
   * and receives display strings plus opaque handles, and only a handle comes back when one is chosen.
   */
  router.get("/delivery/addresses/search", async (request, response) => {
    const parsed = addressSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid address search", status: 400, code: "invalid_request" });
      return;
    }

    try {
      response.json({ results: await addresses.search(parsed.data.q) });
    } catch (error) {
      response.status(502).json({
        title: error instanceof Error ? error.message : "Address search failed",
        status: 502,
        code: "address_search_failed",
      });
    }
  });

  /**
   * Resolves the suggestion the shopper picked. Autocomplete answers with a label and a handle only, and the
   * handle is what carries the coordinates, so the two calls cannot be merged into one request.
   */
  router.post("/delivery/addresses/resolve", async (request, response) => {
    const parsed = addressResolveRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid address reference", status: 400, code: "invalid_request" });
      return;
    }

    try {
      const resolved = await addresses.resolvePrediction(parsed.data.refId);
      if (!resolved) {
        response.status(404).json({ title: "Address could not be resolved", status: 404, code: "address_not_found" });
        return;
      }
      response.json({
        refId: parsed.data.refId,
        displayName: resolved.displayName,
        destination: { latitude: resolved.latitude, longitude: resolved.longitude },
      });
    } catch (error) {
      response.status(502).json({
        title: error instanceof Error ? error.message : "Address resolution failed",
        status: 502,
        code: "address_resolve_failed",
      });
    }
  });

  return router;
};
