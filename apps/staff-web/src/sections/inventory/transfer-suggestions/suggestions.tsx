import { useQuery } from "@tanstack/react-query";
import { Alert, DataTable, type DataColumn, Skeleton } from "@pharmacy/ui";

import { dataTableLabels } from "../../../components/data-table-labels.ts";
import { GatedButton } from "../../../components/gated-button.tsx";
import { translateText } from "../../../i18n.ts";
import { withActionColumn } from "../../../lib/action-column.ts";
import { useCan } from "../../../permissions/use-can.ts";
import { formatQuantity, readOne } from "../../../staff-api.ts";
import { fillText } from "../../procurement/bulk-summary.ts";
import {
  parseTransferSuggestions,
  suggestionsPath,
  TRANSFER_SUGGESTIONS_KEY,
  type TransferSuggestion,
} from "./contract.ts";
import { useInventoryLabels } from "../labels.ts";

/** The sales window that gives each site its daily velocity. The server reads it from the same parameter. */
const WINDOW_DAYS = 30;

/**
 * The transfers the chain should make now, most urgent destination first. A row opens the create drawer with the
 * product, both sites and the quantity filled in; the server still decides nothing on its own.
 */
export const TransferSuggestions = ({
  onCreate,
}: {
  onCreate: (initial: { productId: string; sourceSiteId: string; destinationSiteId: string; quantity: number }) => void;
}): React.JSX.Element => {
  const suggestions = useQuery({
    queryKey: TRANSFER_SUGGESTIONS_KEY,
    queryFn: async () => parseTransferSuggestions(await readOne<unknown>(suggestionsPath(WINDOW_DAYS))),
    retry: false,
  });
  const rows = suggestions.data?.suggestions ?? [];
  const labels = useInventoryLabels(rows.map((row) => row.productId));
  const createGate = useCan("inventory.transfer.create");
  const params = suggestions.data?.params;
  const error = suggestions.error instanceof Error ? suggestions.error.message : undefined;

  const cover = (days: number | null): string =>
    days === null ? translateText("No sales") : `${formatQuantity(days)} ${translateText("days")}`;

  const columns: Array<DataColumn<TransferSuggestion>> = [
    {
      key: "productId",
      label: translateText("Product"),
      truncate: 32,
      render: (row) => labels.product(row.productId),
      text: (row) => labels.product(row.productId),
    },
    { key: "sourceSiteId", label: translateText("From site"), render: (row) => labels.site(row.sourceSiteId) },
    {
      key: "destinationSiteId",
      label: translateText("To site"),
      render: (row) => labels.site(row.destinationSiteId),
    },
    {
      key: "sourceDaysOfCover",
      label: translateText("From cover"),
      align: "right",
      render: (row) => cover(row.sourceDaysOfCover),
    },
    {
      key: "destinationDaysOfCover",
      label: translateText("To cover"),
      align: "right",
      render: (row) => cover(row.destinationDaysOfCover),
    },
    {
      key: "quantity",
      label: translateText("Quantity"),
      align: "right",
      render: (row) => <span className="tabular-nums">{formatQuantity(row.quantity)}</span>,
    },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      enableSorting: false,
      render: (row) => (
        <GatedButton
          gate={createGate}
          size="sm"
          variant="outline"
          onClick={() =>
            onCreate({
              productId: row.productId,
              sourceSiteId: row.sourceSiteId,
              destinationSiteId: row.destinationSiteId,
              quantity: row.quantity,
            })
          }
        >
          {translateText("Create transfer")}
        </GatedButton>
      ),
    },
  ];

  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-semibold text-ink">{translateText("Suggested transfers")}</h2>
      {params ? (
        <p className="text-xs text-muted">
          {fillText(
            translateText(
              "A source site keeps {keep} days of cover, a destination under {trigger} days is filled to {target} days, and stock that cannot sell before it expires is not moved.",
            ),
            { keep: params.keepCoverDays, trigger: params.triggerCoverDays, target: params.targetCoverDays },
          )}
        </p>
      ) : null}
      {suggestions.isPending ? <Skeleton className="h-24" /> : null}
      {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}
      {suggestions.data ? (
        <DataTable<TransferSuggestion>
          storageKey="staff:inventory:transfer-suggestions"
          labels={dataTableLabels()}
          rows={rows}
          getKey={(row) => `${row.productId}:${row.sourceSiteId}:${row.destinationSiteId}`}
          empty={translateText("No transfers are suggested right now.")}
          columns={withActionColumn(columns, createGate.allowed)}
        />
      ) : null}
    </section>
  );
};
