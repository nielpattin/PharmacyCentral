import { useQueries, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../auth.ts";
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

type ReferenceName = Exclude<keyof StaffReferences, "loading" | "error" | "reload">;

const referenceQueryKey = ["staff-references"] as const;

const referencePaths: Record<ReferenceName, string> = {
  sites: "/api/sites",
  locations: "/api/storage-locations",
  suppliers: "/api/suppliers",
  products: "/api/products?limit=100",
  batches: "/api/inventory/batches",
};

const referenceNames = Object.keys(referencePaths) as ReferenceName[];

/**
 * Each reference list loads on its own, so one list a role may not read leaves the others usable instead of
 * blanking every site and product label on the screen. The key holds the user, so an account switch never shows
 * the previous account's lists.
 */
export const useStaffReferences = (): StaffReferences => {
  const queryClient = useQueryClient();
  const session = useSession();
  const queries = useQueries({
    queries: referenceNames.map((name) => ({
      queryKey: [...referenceQueryKey, session.userId, name],
      queryFn: () => readRows(referencePaths[name]),
    })),
  });
  const reload = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: referenceQueryKey });
  };
  const rows = (name: ReferenceName): JsonRecord[] => queries[referenceNames.indexOf(name)]?.data ?? [];
  const failure = queries.find((query) => query.error)?.error;
  return {
    sites: rows("sites"),
    locations: rows("locations"),
    suppliers: rows("suppliers"),
    products: rows("products"),
    batches: rows("batches"),
    loading: queries.some((query) => query.isLoading),
    error: failure instanceof Error ? failure.message : failure ? "Unable to load staff reference data" : undefined,
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
