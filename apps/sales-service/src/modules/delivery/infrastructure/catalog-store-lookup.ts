import type { StoreCoordinateLookup } from "../presentation/delivery-routes.ts";

/** Reads a store's coordinates from the catalog's public store route; undefined when the store is unknown or unreachable. */
export const createCatalogStoreLookup =
  (catalogServiceUrl: string): StoreCoordinateLookup =>
  async (storeId) => {
    try {
      const upstream = await fetch(`${catalogServiceUrl}/stores/${encodeURIComponent(storeId)}`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!upstream.ok) return undefined;
      const store = (await upstream.json()) as {
        id: string;
        coordinates: { latitude: number; longitude: number } | null;
      };
      return store.coordinates ? { id: store.id, ...store.coordinates } : undefined;
    } catch {
      return undefined;
    }
  };
