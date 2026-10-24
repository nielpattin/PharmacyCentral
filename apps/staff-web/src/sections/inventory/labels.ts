import { productLabel, useProductLookup } from "../../hooks/useProductLookup.ts";
import { referenceLabel, referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { type JsonRecord } from "../../staff-api.ts";
import { labelOrShortId, shortId, stringField } from "./format.ts";

export type SelectOption = { value: string; label: string };

export type InventoryLabels = {
  /** "SKU - name", or a short id until the product has loaded. "-" for no id. */
  product: (id: string) => string;
  batch: (id: string) => string;
  site: (id: string) => string;
  location: (id: string) => string;
  /** Batches for one product. Without a product id every batch is offered. An empty product id offers none. */
  batchOptions: (productId?: string) => SelectOption[];
  siteOptions: () => SelectOption[];
  locationOptions: (siteId: string) => SelectOption[];
};

const named = (rows: JsonRecord[], id: string, nameKeys: string[]): string =>
  id === "" ? "-" : labelOrShortId(referenceLabel(rows, id, nameKeys), id);

/**
 * Labels for every id a table or form shows. Pass the product ids of the rows on screen. Products are read by id through
 * the shared product lookup, not from the reference list, which stops at 100 products.
 */
export const useInventoryLabels = (productIds: readonly string[] = []): InventoryLabels => {
  const references = useStaffReferences();
  const products = useProductLookup(productIds);
  return {
    product: (id) => (id === "" ? "-" : productLabel(products.get(id), shortId(id))),
    batch: (id) => named(references.batches, id, ["batchNumber"]),
    site: (id) => named(references.sites, id, ["code", "name"]),
    location: (id) => named(references.locations, id, ["code", "name"]),
    batchOptions: (productId) => {
      if (productId === undefined) return referenceOptions(references.batches, ["batchNumber"]);
      if (productId === "") return [];
      return referenceOptions(
        references.batches.filter((row) => stringField(row, "productId") === productId),
        ["batchNumber"],
      );
    },
    siteOptions: () => referenceOptions(references.sites, ["code", "name"]),
    locationOptions: (siteId) =>
      referenceOptions(
        references.locations.filter((row) => stringField(row, "siteId") === siteId),
        ["code", "name"],
      ),
  };
};
