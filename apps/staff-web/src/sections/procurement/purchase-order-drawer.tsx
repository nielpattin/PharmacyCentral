import { useQuery } from "@tanstack/react-query";
import { DataTable, Skeleton } from "@pharmacy/ui";

import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { dataTableLabels } from "../../components/data-table-labels.ts";
import { GatedButton } from "../../components/gated-button.tsx";
import { useProductLookup, productLabel } from "../../hooks/useProductLookup.ts";
import { useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useSession } from "../../auth.ts";
import { can, ownerOf } from "../../permissions/staff-permissions.ts";
import { translateText } from "../../i18n.ts";
import { useCan } from "../../permissions/use-can.ts";
import { asRows, formatDate, formatQuantity, readOne, text, type JsonRecord } from "../../staff-api.ts";
import { referenceName, shortId } from "./labels.ts";
import {
  PURCHASE_ORDERS_KEY,
  canApprovePurchaseOrder,
  canCancelPurchaseOrder,
  purchaseOrderNumber,
  purchaseOrderTone,
  usePurchaseOrderActions,
} from "./purchase-order-actions.ts";

/**
 * One purchase order with its lines, in a drawer over the list. The list row shows at once; the detail route fills in
 * the lines. Approve and cancel live in the footer and follow the same rules as the row actions.
 */
export const PurchaseOrderDrawer = ({
  orderId,
  summary,
  onClose,
}: {
  orderId: string | undefined;
  summary: JsonRecord | undefined;
  onClose: () => void;
}): React.JSX.Element => {
  const references = useStaffReferences();
  const actions = usePurchaseOrderActions();
  const cancelGate = useCan("purchaseOrder.cancel");
  const session = useSession();
  const detail = useQuery({
    queryKey: [...PURCHASE_ORDERS_KEY, "detail", orderId],
    queryFn: () => readOne<JsonRecord>(`/api/procurement/purchase-orders/${encodeURIComponent(orderId ?? "")}`),
    enabled: orderId !== undefined,
  });
  const order = detail.data ?? summary;
  const lines = asRows(order?.lines);
  const products = useProductLookup(lines.map((line) => text(line.productId, "")));

  return (
    <EntityDrawer
      open={orderId !== undefined}
      onClose={onClose}
      title={order ? purchaseOrderNumber(order) : ""}
      subtitle={translateText("Purchase order")}
      status={order ? { label: translateText(text(order.status)), tone: purchaseOrderTone(order.status) } : undefined}
      details={
        order ? (
          <div className="grid gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted">{translateText("Supplier")}</dt>
                <dd className="text-sm text-ink">
                  {referenceName(references.suppliers, order.supplierId, ["code", "name"])}
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted">{translateText("Site")}</dt>
                <dd className="text-sm text-ink">{referenceName(references.sites, order.siteId, ["code", "name"])}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted">{translateText("Expected date")}</dt>
                <dd className="text-sm text-ink">{formatDate(order.expectedDate)}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted">{translateText("Notes")}</dt>
                <dd className="text-sm text-ink">{text(order.notes)}</dd>
              </div>
            </dl>
            <DataTable
              storageKey="staff:procurement:po-lines"
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
                {
                  key: "orderedQuantity",
                  label: translateText("Ordered"),
                  align: "right",
                  render: (row) => formatQuantity(row.orderedQuantity),
                },
                {
                  key: "receivedQuantity",
                  label: translateText("Received"),
                  align: "right",
                  render: (row) => formatQuantity(row.receivedQuantity),
                },
                { key: "notes", label: translateText("Notes"), truncate: 32 },
              ]}
            />
          </div>
        ) : (
          <Skeleton className="h-32" />
        )
      }
      footer={
        order ? (
          <>
            {canApprovePurchaseOrder(order.status) ? (
              <GatedButton
                gate={can("purchaseOrder.approve", session, ownerOf(order.createdBy))}
                onClick={() => void actions.approve(order)}
              >
                {translateText("Approve")}
              </GatedButton>
            ) : null}
            {canCancelPurchaseOrder(order.status) ? (
              <GatedButton gate={cancelGate} variant="danger-soft" onClick={() => void actions.cancel(order)}>
                {translateText("Cancel")}
              </GatedButton>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
};
