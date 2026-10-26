import { Alert, Skeleton } from "@pharmacy/ui";
import type { UseQueryResult } from "@tanstack/react-query";

import type { CatalogStore, CustomerOrder, CustomerOrderDetail } from "../../customer-api.ts";
import { formatDateTime, formatMoney, formatQuantity } from "../../storefront/format.ts";
import { orderStep, paymentStatusBadge } from "../../storefront/order-status.ts";
import { OrderSteps } from "./OrderProgress.tsx";

const Heading = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <h4 className="text-sm font-semibold text-ink">{children}</h4>
);

/**
 * What the shopper sees when an order is opened: where it stands, what was bought, what it cost and where to collect
 * it. The list endpoint carries no lines, so this reads the detail query the row already owns.
 */
export const OrderDetail = ({
  id,
  order,
  store,
  query,
  showSteps = true,
}: {
  id: string;
  order: CustomerOrder;
  store: CatalogStore | undefined;
  query: UseQueryResult<CustomerOrderDetail>;
  /** The featured order already draws the labelled steps above its detail, so it asks for them to be left out. */
  showSteps?: boolean;
}): React.JSX.Element => {
  const step = orderStep(order.status);
  const cancelled = order.status.toLowerCase() === "cancelled";
  const payment = paymentStatusBadge(order.paymentStatus);
  const detail = query.data;

  return (
    <div id={id} className="grid gap-6 border-t border-line bg-surface-soft px-5 py-5">
      {!showSteps ? null : step !== undefined ? (
        <OrderSteps step={step} fulfillmentType={order.fulfillmentType} />
      ) : cancelled ? (
        <p className="text-sm text-muted">Đơn hàng đã huỷ.</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="grid content-start gap-3">
          <Heading>Sản phẩm</Heading>
          {query.isPending ? (
            <div role="status" aria-label="Đang tải chi tiết đơn" className="grid gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : query.error ? (
            <Alert variant="danger">
              {query.error instanceof Error ? query.error.message : "Không tải được đơn hàng."}
            </Alert>
          ) : detail ? (
            <>
              <ul className="grid gap-3">
                {detail.lines.map((line) => (
                  <li
                    key={`${line.productId}-${line.productUnitId}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-sm"
                  >
                    <span className="text-ink">{line.productNameSnapshot}</span>
                    <span className="font-medium tabular-nums text-ink">
                      {formatMoney(Number(line.quantity) * Number(line.unitPriceSnapshot), detail.currency)}
                    </span>
                    <span className="text-xs tabular-nums text-muted">
                      {formatQuantity(line.quantity)} × {formatMoney(line.unitPriceSnapshot, detail.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="grid gap-1.5 border-t border-line pt-3 text-sm">
                <div className="flex justify-between gap-4 text-muted">
                  <dt>Tạm tính</dt>
                  <dd className="tabular-nums">{formatMoney(detail.subtotal, detail.currency)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-muted">
                  <dt>Phí giao hàng</dt>
                  <dd className="tabular-nums">{formatMoney(detail.deliveryFee, detail.currency)}</dd>
                </div>
                <div className="flex justify-between gap-4 font-semibold text-ink">
                  <dt>Tổng cộng</dt>
                  <dd className="tabular-nums text-primary-dark">
                    {formatMoney(Number(detail.subtotal) + Number(detail.deliveryFee), detail.currency)}
                  </dd>
                </div>
              </dl>
            </>
          ) : null}
        </section>

        <section className="grid content-start gap-3">
          <Heading>{order.fulfillmentType === "pickup" ? "Thông tin nhận hàng" : "Thông tin giao hàng"}</Heading>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Hình thức</dt>
            <dd className="text-ink">{order.fulfillmentType === "pickup" ? "Nhận tại nhà thuốc" : "Giao tận nơi"}</dd>
            {store ? (
              <>
                <dt className="text-muted">Nhà thuốc</dt>
                <dd className="text-ink">{store.name}</dd>
                {store.address ? (
                  <>
                    <dt className="text-muted">Địa chỉ</dt>
                    <dd className="text-ink">{store.address}</dd>
                  </>
                ) : null}
              </>
            ) : null}
            {detail?.delivery ? (
              <>
                <dt className="text-muted">Giao đến</dt>
                <dd className="text-ink">
                  {detail.delivery.providerResolvedAddress}
                  {detail.delivery.addressNote ? ` · ${detail.delivery.addressNote}` : ""}
                </dd>
              </>
            ) : null}
            {cancelled ? null : (
              <>
                <dt className="text-muted">Thanh toán</dt>
                <dd className={payment.tone === "danger" ? "text-danger-ink" : "text-ink"}>{payment.label}</dd>
              </>
            )}
            <dt className="text-muted">Đặt lúc</dt>
            <dd className="text-ink">{formatDateTime(order.createdAt)}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
};
