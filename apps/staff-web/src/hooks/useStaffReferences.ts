import { useState } from "react";

import { useMountEffect } from "./useMountEffect.ts";
import { readRows, type JsonRecord } from "../staff-api.ts";

export type StaffReferences = {
  sites: JsonRecord[];
  locations: JsonRecord[];
  suppliers: JsonRecord[];
  products: JsonRecord[];
  batches: JsonRecord[];
  loading: boolean;
  error?: string | undefined;
  reload: () => Promise<void>;
};

export const useStaffReferences = (): StaffReferences => {
  const [sites, setSites] = useState<JsonRecord[]>([]);
  const [locations, setLocations] = useState<JsonRecord[]>([]);
  const [suppliers, setSuppliers] = useState<JsonRecord[]>([]);
  const [products, setProducts] = useState<JsonRecord[]>([]);
  const [batches, setBatches] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const reload = async (): Promise<void> => {
    try {
      setLoading(true);
      setError(undefined);
      const [nextSites, nextLocations, nextSuppliers, nextProducts, nextBatches] = await Promise.all([
        readRows("/api/sites"),
        readRows("/api/storage-locations"),
        readRows("/api/suppliers"),
        readRows("/api/products?limit=100"),
        readRows("/api/inventory/batches"),
      ]);
      setSites(nextSites);
      setLocations(nextLocations);
      setSuppliers(nextSuppliers);
      setProducts(nextProducts);
      setBatches(nextBatches);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load staff reference data");
    } finally {
      setLoading(false);
    }
  };

  useMountEffect(() => {
    void reload();
  });
  return { sites, locations, suppliers, products, batches, loading, error, reload };
};

export const referenceOptions = (
  rows: JsonRecord[],
  nameKeys: string[] = ["name"],
): Array<{ value: string; label: string }> =>
  rows
    .map((row) => {
      const id = typeof row.id === "string" ? row.id : "";
      const label = nameKeys
        .map((key) => row[key])
        .map((value) => (typeof value === "string" ? value : ""))
        .filter(Boolean)
        .join(" - ");
      return { value: id, label: label || id };
    })
    .filter((option) => option.value.length > 0);
