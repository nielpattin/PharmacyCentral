import { Card, CardContent, CardHeader, CardTitle, StatusCell } from "@pharmacy/ui";

import type { CatalogStore, CustomerOrder } from "../../customer-api.ts";
import { formatDateTime, formatMoney } from "../../storefront/format.ts";
import { orderStatusBadge, paymentStatusBadge } from "../../storefront/order-status.ts";
import { IconReceipt } from "../storefront/icons.tsx";

export const OrderHistory = ({
  orders,
  stores,
}: {
  orders: CustomerOrder[];
  stores: CatalogStore[];
}): React.JSX.Element => (
  <Card>
    <CardHeader className="flex items-center justify-between gap-2">
      <CardTitle>Đơn gần đây</CardTitle>
      {orders.length > 0 ? <span className="text-xs text-muted">{orders.length} đơn</span> : null}
    </CardHeader>
    <CardContent>
      {orders.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-line bg-surface-soft/60 px-6 py-8 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-surface text-muted-soft">
            <IconReceipt className="size-5" />
          </span>
          <p className="text-sm font-medium text-ink">Bạn chưa có đơn hàng nào</p>
          <p className="mx-auto max-w-sm text-sm text-muted">
            Sau khi đặt hàng, đơn sẽ xuất hiện ở đây để bạn theo dõi trạng thái soạn thuốc và giao hàng.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {orders.map((order) => {
            const status = orderStatusBadge(order.status);
            const payment = paymentStatusBadge(order.paymentStatus);
            const store = stores.find((candidate) => candidate.id === order.selectedStoreId);
            return (
              <li key={order.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">Đơn #{order.id.slice(0, 8).toUpperCase()}</p>
                    <p className="mt-0.5 text-xs text-muted">{formatDateTime(order.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusCell tone={status.tone}>{status.label}</StatusCell>
                    <StatusCell tone={payment.tone}>{payment.label}</StatusCell>
                  </div>
                </div>

                <p className="mt-2 text-xs text-muted">
                  {order.fulfillmentType === "pickup" ? "Nhận tại nhà thuốc" : "Giao tận nơi"}
                  {store ? ` · ${store.name}` : ""}
                </p>

                <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                  <span className="text-sm text-muted">Tổng cộng</span>
                  <span className="text-base font-semibold text-danger">
                    {formatMoney(Number(order.subtotal) + Number(order.deliveryFee), order.currency)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CardContent>
  </Card>
);
