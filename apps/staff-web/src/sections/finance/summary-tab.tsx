import { useQuery } from "@tanstack/react-query";
import { Alert, Button, DataTable, StatTile } from "@pharmacy/ui";
import { useState } from "react";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { translateText } from "../../i18n.ts";
import { useCan } from "../../permissions/use-can.ts";
import { asRows, formatDateTime, formatQuantity, readOne, text, type JsonRecord } from "../../staff-api.ts";
import { CreatePlanDrawer } from "../action-plans/create-plan-drawer.tsx";
import { priceWarningDraft, type ActionPlanDraft } from "../action-plans/drafts.ts";
import { FINANCE_SUMMARY_KEY } from "./query-keys.ts";

/** Headline figures from `/api/finance/summary`: label, summary field, and whether the value is money. */
const HEADLINES: ReadonlyArray<readonly [string, string, boolean]> = [
  ["Paid", "paid", true],
  ["Refunded", "refunded", true],
  ["Net", "net", true],
  ["Inventory value", "inventoryValue", true],
  ["Reserved value", "reservedValue", true],
  ["Missing prices", "missingPriceCount", false],
  ["Receipts", "receiptQuantity", false],
  ["Dispensed", "dispensedQuantity", false],
  ["Returns", "returnQuantity", false],
  ["Adjustments", "adjustmentQuantity", false],
  ["Transfer out", "transferOutQuantity", false],
  ["Transfer in", "transferInQuantity", false],
];

export const SummaryTab = (): React.JSX.Element => {
  const summaryQuery = useQuery({
    queryKey: FINANCE_SUMMARY_KEY,
    queryFn: () => readOne<JsonRecord>("/api/finance/summary"),
  });
  const summary = summaryQuery.data;
  const currency = text(summary?.currency, "VND");
  const planGate = useCan("actionPlan.create");
  const [planDraft, setPlanDraft] = useState<ActionPlanDraft>();

  return (
    <div className="grid gap-6">
      {summaryQuery.error ? <Alert variant="danger">{translateText(summaryQuery.error.message)}</Alert> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
        {HEADLINES.map(([label, field, isMoney]) => (
          <StatTile
            key={label}
            label={translateText(label)}
            value={
              isMoney ? `${formatQuantity(summary?.[field] ?? 0)} ${currency}` : formatQuantity(summary?.[field] ?? 0)
            }
          />
        ))}
      </div>
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold text-ink">{translateText("Inventory activity")}</h2>
        <DataTable
          storageKey="staff:finance:activity"
          labels={dataTableLabels()}
          interactive
          loading={summaryQuery.isPending}
          rows={asRows(summary?.activityLines)}
          empty={translateText("No records found")}
          columns={[
            {
              key: "activityType",
              label: translateText("Activity"),
              render: (row) => translateText(text(row.activityType)),
            },
            { key: "count", label: translateText("Count"), align: "right", render: (row) => formatQuantity(row.count) },
            {
              key: "quantityIn",
              label: translateText("Quantity in"),
              align: "right",
              render: (row) => formatQuantity(row.quantityIn),
            },
            {
              key: "quantityOut",
              label: translateText("Quantity out"),
              align: "right",
              render: (row) => formatQuantity(row.quantityOut),
            },
            {
              key: "latestActivityAtUtc",
              label: translateText("Latest"),
              render: (row) => formatDateTime(row.latestActivityAtUtc),
            },
          ]}
        />
      </section>
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold text-ink">{translateText("Inventory valuation")}</h2>
        <DataTable
          storageKey="staff:finance:valuation"
          labels={dataTableLabels()}
          interactive
          loading={summaryQuery.isPending}
          rows={asRows(summary?.valuationLines)}
          empty={translateText("No records found")}
          exportCsv={{ filename: "inventory-valuation.csv" }}
          columns={[
            { key: "productName", label: translateText("Product"), truncate: 32 },
            { key: "batchNumber", label: translateText("Batch") },
            { key: "siteName", label: translateText("Site") },
            {
              key: "quantityOnHand",
              label: translateText("On hand"),
              align: "right",
              render: (row) => formatQuantity(row.quantityOnHand),
            },
            {
              key: "valueOnHand",
              label: translateText("Value"),
              align: "right",
              render: (row) => (row.valueOnHand === null ? "-" : `${formatQuantity(row.valueOnHand)} ${currency}`),
              text: (row) => row.valueOnHand,
            },
            {
              key: "priceStatus",
              label: translateText("Price status"),
              render: (row) => translateText(text(row.priceStatus)),
            },
            {
              key: "actions",
              label: translateText("Actions"),
              pinned: "right",
              enableSorting: false,
              render: (row) => {
                const productId = typeof row.productId === "string" ? row.productId : undefined;
                if (!planGate.allowed || productId === undefined || row.priceStatus !== "Missing price") return null;
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPlanDraft(
                        priceWarningDraft({
                          productId,
                          productName: text(row.productName, productId),
                          siteId: typeof row.siteId === "string" ? row.siteId : null,
                        }),
                      )
                    }
                  >
                    {translateText("Create plan")}
                  </Button>
                );
              },
            },
          ]}
        />
      </section>
      {planDraft ? <CreatePlanDrawer draft={planDraft} onClose={() => setPlanDraft(undefined)} /> : null}
    </div>
  );
};
