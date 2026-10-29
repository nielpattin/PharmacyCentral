import { useQuery } from "@tanstack/react-query";
import { DataTable, Skeleton } from "@pharmacy/ui";

import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { dataTableLabels } from "../../components/data-table-labels.ts";
import { productLabel, useProductLookup } from "../../hooks/useProductLookup.ts";
import { useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { asRows, formatDate, formatDateTime, formatQuantity, readOne, text, type JsonRecord } from "../../staff-api.ts";
import { formatAmount } from "../sales/rules.ts";
import { moneyLocale } from "../sales/shared.tsx";
import { referenceName, shortId } from "./labels.ts";
import { GOODS_RECEIPTS_KEY } from "./query-keys.ts";

/**
 * One goods receipt with its lines, in a drawer over the list. The list row shows at once; the detail route fills in
 * the lines.
 */
export const GoodsReceiptDrawer = ({
  receiptId,
  summary,
  onClose,
}: {
  receiptId: string | undefined;
  summary: JsonRecord | undefined;
  onClose: () => void;
}): React.JSX.Element => {
  const references = useStaffReferences();
  const detail = useQuery({
    queryKey: [...GOODS_RECEIPTS_KEY, "detail", receiptId],
    queryFn: () => readOne<JsonRecord>(`/api/procurement/goods-receipts/${encodeURIComponent(receiptId ?? "")}`),
    enabled: receiptId !== undefined,
  });
  const receipt = detail.data ?? summary;
  const lines = asRows(receipt?.lines);
  const products = useProductLookup(lines.map((line) => text(line.productId, "")));
  const title = receipt ? text(receipt.receiptNumber, "") || shortId(receipt.id) : "";

  return (
    <EntityDrawer
      open={receiptId !== undefined}
      onClose={onClose}
      title={title}
      subtitle={translateText("Goods receipt")}
      details={
        receipt ? (
          <div className="grid gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted">{translateText("Supplier")}</dt>
                <dd className="text-sm text-ink">
                  {referenceName(references.suppliers, receipt.supplierId, ["code", "name"])}
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted">{translateText("Site")}</dt>
                <dd className="text-sm text-ink">
                  {referenceName(references.sites, receipt.siteId, ["code", "name"])}
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted">{translateText("Received")}</dt>
                <dd className="text-sm text-ink">{formatDateTime(receipt.receivedAt)}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted">{translateText("Notes")}</dt>
                <dd className="text-sm text-ink">{text(receipt.notes)}</dd>
              </div>
            </dl>
            <DataTable
              storageKey="staff:procurement:receipt-lines"
              labels={dataTableLabels()}
              rows={lines}
              getKey={(_row, index) => String(index)}
              empty={translateText("No records found")}
              columns={[
                {
                  key: "productId",
                  label: translateText("Product"),
                  render: (row) => {
                    const id = text(row.productId, "");
                    return productLabel(products.get(id), shortId(id));
                  },
                },
                { key: "batchNumber", label: translateText("Batch number") },
                { key: "expiryDate", label: translateText("Expiry date"), render: (row) => formatDate(row.expiryDate) },
                {
                  key: "manufacturedDate",
                  label: translateText("Manufactured date"),
                  render: (row) => formatDate(row.manufacturedDate),
                },
                { key: "manufacturer", label: translateText("Manufacturer"), truncate: 24 },
                {
                  key: "quantity",
                  label: translateText("Quantity"),
                  align: "right",
                  render: (row) => formatQuantity(row.quantity),
                },
                {
                  key: "unitCost",
                  label: translateText("Unit cost"),
                  align: "right",
                  render: (row) =>
                    row.unitCost === null || row.unitCost === undefined
                      ? "—"
                      : formatAmount(row.unitCost, "VND", moneyLocale()),
                },
                { key: "notes", label: translateText("Notes"), truncate: 32 },
              ]}
            />
          </div>
        ) : (
          <Skeleton className="h-32" />
        )
      }
    />
  );
};
