import { useQuery, useQueryClient } from "@tanstack/react-query";

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

type StaffReferenceData = Omit<StaffReferences, "loading" | "error" | "reload">;

const referenceQueryKey = ["staff-references"] as const;

const loadReferences = async (): Promise<StaffReferenceData> => {
  const [sites, locations, suppliers, products, batches] = await Promise.all([
    readRows("/api/sites"),
    readRows("/api/storage-locations"),
    readRows("/api/suppliers"),
    readRows("/api/products?limit=100"),
    readRows("/api/inventory/batches"),
  ]);
  return { sites, locations, suppliers, products, batches };
};

export const useStaffReferences = (): StaffReferences => {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: referenceQueryKey, queryFn: loadReferences });
  const reload = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: referenceQueryKey });
  };
  return {
    sites: query.data?.sites ?? [],
    locations: query.data?.locations ?? [],
    suppliers: query.data?.suppliers ?? [],
    products: query.data?.products ?? [],
    batches: query.data?.batches ?? [],
    loading: query.isPending,
    error:
      query.error instanceof Error
        ? query.error.message
        : query.error
          ? "Unable to load staff reference data"
          : undefined,
    reload,
  };
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

export const referenceLabel = (rows: JsonRecord[], id: unknown, nameKeys: string[] = ["name"]): string => {
  const idValue = typeof id === "string" || typeof id === "number" || typeof id === "bigint" ? id.toString() : "";
  const row = rows.find((candidate) => candidate.id === idValue);
  if (!row) return idValue;
  const label = nameKeys
    .map((key) => row[key])
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join(" - ");
  return label || idValue;
};
