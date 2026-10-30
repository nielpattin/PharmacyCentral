import { useState } from "react";

import { Button, DataTable, type DataColumn, Skeleton, StatTile } from "@pharmacy/ui";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { useRetainedTarget } from "../../hooks/useRetainedTarget.ts";
import { translateText } from "../../i18n.ts";
import { withActionColumn } from "../../lib/action-column.ts";
import { useCan } from "../../permissions/use-can.ts";
import { CreatePlanDrawer } from "../action-plans/create-plan-drawer.tsx";
import { deadStockDraft, type ActionPlanDraft } from "../action-plans/drafts.ts";
import type { AnalyticsInventoryResponse, DeadStockItem, ExpiryBucket, InventoryHealth } from "./contract.ts";
import { formatRate } from "./figures.ts";
import { Heading, type FigureFormat } from "./shared.tsx";

type ExpiryKey = keyof InventoryHealth["expiry"];
type ExpiryRow = { key: ExpiryKey; label: string; bucket: ExpiryBucket | undefined };
type SiteStockRow = InventoryHealth["stockValue"]["bySite"][number];
type DeadStockRow = DeadStockItem & { site: string };

const EXPIRY_GROUPS: ReadonlyArray<{ key: ExpiryKey; label: string }> = [
  { key: "expired", label: "Expired" },
  { key: "within30", label: "Within 30 days" },
  { key: "within60", label: "31 to 60 days" },
  { key: "within90", label: "61 to 90 days" },
];

/** Stock health now and over the period, with the dead stock rows that become action plans. */
export const InventoryTab = ({
  data,
  loading,
  locale,
  format,
  siteLabel,
}: {
  data: AnalyticsInventoryResponse | undefined;
  loading: boolean;
  locale: string;
  format: FigureFormat;
  /** A site's label, for the dead stock rows that name one. */
  siteLabel: (siteId: string) => string;
}): React.JSX.Element => {
  const inventory = data?.inventory;
  const deadStockDays = inventory?.deadStock.deadStockDays;
  const planGate = useCan("actionPlan.create");
  const [planDraft, setPlanDraft] = useState<ActionPlanDraft>();
  const planDrawer = useRetainedTarget(planDraft);

  const expiryRows: ExpiryRow[] = EXPIRY_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    bucket: inventory?.expiry[group.key],
  }));
  const siteStockRows: SiteStockRow[] = inventory?.stockValue.bySite ?? [];
  const deadStockRows: DeadStockRow[] = (inventory?.deadStock.items ?? []).map((item) => ({
    ...item,
    site: siteLabel(item.siteId),
  }));

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <Heading>Inventory health</Heading>
        <p className="text-xs text-muted">
          {translateText(
            "The channel does not change inventory figures. Turnover and days of inventory cover the chosen period; stockout rate, dead stock and expiry are the current state.",
          )}
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {loading ? (
            Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-[98px]" />)
          ) : (
            <>
              <StatTile
                label={translateText("Inventory turnover")}
                value={format.count(inventory?.turnover)}
                hint={translateText("In the period")}
              />
              <StatTile
                label={translateText("Days of inventory")}
                value={format.count(inventory?.daysOfInventory)}
                hint={translateText("Period days divided by turnover")}
              />
              <StatTile
                label={translateText("Stockout rate")}
                value={formatRate(inventory?.stockoutRate, locale)}
                hint={
                  <span className="grid gap-0.5">
                    <span>{translateText("Now")}</span>
                    <span>
                      {translateText("Out of stock now")}: {format.count(inventory?.outOfStockProductCount)} /{" "}
                      {format.count(inventory?.stockedProductCount)}
                    </span>
                  </span>
                }
              />
              <StatTile
                label={translateText("Dead stock")}
                value={format.count(inventory?.deadStock.productCount)}
                hint={
                  <span>
                    {translateText("No movement in the last")} {format.count(inventory?.deadStock.deadStockDays)}{" "}
                    {translateText("days")}
                  </span>
                }
              />
              <StatTile
                label={translateText("Dead stock quantity")}
                value={format.count(inventory?.deadStock.quantity)}
                hint={translateText("Now")}
              />
              <StatTile
                label={translateText("Dead stock value")}
                value={format.money(inventory?.deadStock.value)}
                hint={translateText("Now")}
              />
              <StatTile
                label={translateText("Total stock value")}
                value={format.money(inventory?.stockValue.total)}
                hint={
                  <span>
                    {translateText("Products without a published price")}:{" "}
                    {format.count(inventory?.stockValue.missingPriceCount)}
                  </span>
                }
              />
            </>
          )}
        </div>
      </section>

      <section className="grid gap-2">
        <Heading>Stock value by site</Heading>
        <DataTable<SiteStockRow>
          storageKey="staff:analytics:stock-by-site"
          labels={dataTableLabels()}
          loading={loading}
          rows={siteStockRows}
          getKey={(row) => row.siteId}
          empty={translateText("No records found")}
          columns={[
            { key: "siteName", label: translateText("Site"), render: (row) => row.siteName },
            {
              key: "quantity",
              label: translateText("Quantity"),
              align: "right",
              render: (row) => format.count(row.quantity),
            },
            {
              key: "value",
              label: translateText("Value"),
              align: "right",
              render: (row) => format.money(row.value),
            },
          ]}
        />
      </section>

      <section className="grid gap-2">
        <Heading>Expiring in 30 / 60 / 90 days</Heading>
        <DataTable<ExpiryRow>
          storageKey="staff:analytics:expiry"
          labels={dataTableLabels()}
          loading={loading}
          rows={expiryRows}
          getKey={(row) => row.key}
          empty={translateText("No records found")}
          columns={[
            { key: "label", label: translateText("Expiry group"), render: (row) => translateText(row.label) },
            {
              key: "productCount",
              label: translateText("Products"),
              align: "right",
              render: (row) => format.count(row.bucket?.productCount),
            },
            {
              key: "quantity",
              label: translateText("Quantity"),
              align: "right",
              render: (row) => format.count(row.bucket?.quantity),
            },
            {
              key: "value",
              label: translateText("Value"),
              align: "right",
              render: (row) => format.money(row.bucket?.value),
            },
          ]}
        />
      </section>

      <section className="grid gap-2">
        <Heading>Dead stock items</Heading>
        <DataTable<DeadStockRow>
          storageKey="staff:analytics:dead-stock"
          labels={dataTableLabels()}
          interactive
          exportCsv={{ filename: "analytics-dead-stock.csv" }}
          loading={loading}
          rows={deadStockRows}
          getKey={(row) => `${row.siteId}:${row.productId}`}
          empty={translateText("No records found")}
          columns={withActionColumn<DataColumn<DeadStockRow>>(
            [
              { key: "productName", label: translateText("Product"), truncate: 32 },
              { key: "site", label: translateText("Site") },
              {
                key: "quantity",
                label: translateText("Quantity"),
                align: "right",
                render: (row) => format.count(row.quantity),
              },
              {
                key: "value",
                label: translateText("Value"),
                align: "right",
                render: (row) => format.money(row.value),
              },
              {
                key: "actions",
                label: translateText("Actions"),
                pinned: "right",
                enableSorting: false,
                render: (row) =>
                  planGate.allowed && deadStockDays !== undefined ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPlanDraft(
                          deadStockDraft({
                            siteId: row.siteId,
                            productId: row.productId,
                            productName: row.productName,
                            quantity: row.quantity,
                            deadStockDays,
                          }),
                        )
                      }
                    >
                      {translateText("Create plan")}
                    </Button>
                  ) : null,
              },
            ],
            planGate.allowed && deadStockDays !== undefined && deadStockRows.length > 0,
          )}
        />
      </section>

      {planDrawer ? (
        <CreatePlanDrawer
          key={planDrawer.key}
          open={planDraft !== undefined}
          draft={planDrawer.target}
          onClose={() => setPlanDraft(undefined)}
        />
      ) : null}
    </div>
  );
};
