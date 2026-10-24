import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Alert } from "@pharmacy/ui";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { translateText } from "../../i18n.ts";
import { readSystemRoutes, SYSTEM_ROUTES_QUERY_KEY, type SystemRouteRow } from "./catalog-api.ts";
import { SYSTEM_STATIC_STALE_MS } from "./constants.ts";
import { filterRouteRows } from "./route-rows.ts";
import { SectionCard } from "./system-cards.tsx";

const ACCESS_LABEL: Record<"public" | "signed-in" | "platform-admin", string> = {
  public: "Public",
  "signed-in": "Signed in",
  "platform-admin": "Platform Admin only",
};

// The table component passes each cell its row as a generic record; the rows are SystemRouteRow values.
const COLUMNS: Column[] = [
  {
    key: "path",
    label: "Path",
    render: (row) => {
      const route = row as SystemRouteRow;
      return (
        <code className="font-mono text-xs">
          {route.method === undefined ? route.path : `${route.method} ${route.path}`}
        </code>
      );
    },
  },
  { key: "service", label: "Service" },
  {
    key: "access",
    label: "Access",
    enableSorting: false,
    render: (row) => {
      const { access } = row as SystemRouteRow;
      return access.kind === "roles"
        ? access.roles.map((role) => translateText(role)).join(", ")
        : translateText(ACCESS_LABEL[access.kind]);
    },
  },
  {
    key: "note",
    label: "Note",
    enableSorting: false,
    render: (row) => {
      const { note } = row as SystemRouteRow;
      return note === undefined ? null : translateText(note);
    },
  },
];

// The gateway's path table: which service each API path goes to and who may call it. Read only.
export const RoutesCard = (): React.JSX.Element => {
  const routesQuery = useQuery({
    queryKey: SYSTEM_ROUTES_QUERY_KEY,
    queryFn: readSystemRoutes,
    staleTime: SYSTEM_STATIC_STALE_MS,
    retry: false,
  });
  const [query, setQuery] = useState("");
  const visible = filterRouteRows(routesQuery.data?.routes ?? [], query);

  return (
    <SectionCard
      title="Routes"
      description="The API paths the gateway sends to each service, and who may call them. Read only: the edge policy enforces access."
    >
      {routesQuery.isError ? (
        <Alert variant="danger">{translateText("Route table unavailable.")}</Alert>
      ) : (
        <DataTable
          rows={visible}
          columns={COLUMNS}
          virtualize={false}
          loading={routesQuery.isPending}
          empty="No routes match this filter."

          search={{
            value: query,
            onChange: setQuery,
            placeholder: translateText("Filter routes"),
          }}
        />
      )}
    </SectionCard>
  );
};
