import type { SystemRouteRow } from "./catalog-api.ts";

/**
 * Rows whose path, method, service, access, or note contains the query, ignoring case. An empty query keeps every row.
 * The table is a constant of 30 rows, so the filter runs here rather than on the server.
 */
export const filterRouteRows = (rows: readonly SystemRouteRow[], query: string): SystemRouteRow[] => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) =>
    [
      row.method,
      row.path,
      row.service,
      row.access.kind === "roles" ? row.access.roles.join(" ") : row.access.kind,
      row.note,
    ]
      .filter((part): part is string => part !== undefined)
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
};
