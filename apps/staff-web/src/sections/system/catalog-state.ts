import type { SystemServiceCatalog, SystemServiceEntry } from "./catalog-api.ts";

export type CatalogView =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; entry: SystemServiceEntry };

/**
 * What the sheet's catalog block shows for one service. The loaded catalog wins over a later failed refetch, so a
 * failure never hides data already on screen. Without data, the block is loading until the first answer or error.
 */
export const catalogView = (
  query: { data: SystemServiceCatalog | undefined; isError: boolean },
  serviceName: string,
): CatalogView => {
  if (query.data !== undefined) {
    const entry = query.data.services.find((service) => service.name === serviceName);
    return entry === undefined ? { status: "missing" } : { status: "ready", entry };
  }
  return query.isError ? { status: "error" } : { status: "loading" };
};
