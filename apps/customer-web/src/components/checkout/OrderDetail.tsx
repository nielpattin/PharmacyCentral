import { Alert, Button, Skeleton } from "@pharmacy/ui";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";

import {
  getPaymentInvoice,
  type CatalogStore,
  type CustomerOrder,
  type CustomerOrderDetail,
} from "../../customer-api.ts";
import { formatDateTime, formatMoney, formatQuantity } from "../../storefront/format.ts";
import { invoicePaid, orderStep, paymentStatusBadge } from "../../storefront/order-status.ts";
import { IconCopy, IconQr } from "../storefront/icons.tsx";
import { OrderSteps } from "./OrderProgress.tsx";

/** The invoice is re-read at this pace while the transfer is still awaited, as the order list is. */
const REFRESH_INTERVAL_MS = 10_000;

const PAYMENT_METHOD_LABELS = {
  sepay_qr: "Chuyển khoản SePay QR",
  cash_on_delivery: "Thanh toán khi nhận hàng",
} as const;

const Heading = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <h4 className="text-sm font-semibold text-ink">{children}</h4>
);

/**
 * The transfer instructions of an order that is still waiting for money: the QR, the code, the exact amount and the
 * content to type. It reads the invoice (its id is the order id) and stops re-reading once the invoice is paid, so
 * the block turns into a confirmation by itself.
 */
const TransferPayment = ({ orderId }: { orderId: string }): React.JSX.Element => {
  const [copied, setCopied] = useState(false);
  const invoice = useQuery({
    queryKey: ["customer-orders", "invoice", orderId],
    queryFn: () => getPaymentInvoice(orderId),
    refetchInterval: (query) =>
      query.state.data && !invoicePaid(query.state.data.status) ? REFRESH_INTERVAL_MS : false,
  });

  if (invoice.isPending)
    return (
      <div
        role="status"
        aria-label="Đang tải thông tin chuyển khoản"
        className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]"
      >
        <Skeleton className="aspect-square w-48" />
        <div className="grid content-start gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );

  if (invoice.data === undefined)
    return (
      <div className="grid justify-items-start gap-3">
        <Alert variant="danger">
          {invoice.error instanceof Error ? invoice.error.message : "Không tải được thông tin chuyển khoản."}
        </Alert>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={invoice.isFetching}
          onClick={() => void invoice.refetch()}
        >
          Thử lại
        </Button>
      </div>
    );

  const { data } = invoice;
  if (invoicePaid(data.status))
    return <p className="text-sm font-medium text-ink">Nhà thuốc đã nhận đủ tiền cho đơn này.</p>;

  const instruction = data.paymentInstruction;
  if (!instruction) return <p className="text-sm text-muted">Đơn này không còn cần chuyển khoản.</p>;

  return (
    <div className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <img
        src={instruction.qrImageUrl}
        alt="Mã QR chuyển khoản SePay cho đơn hàng"
        className="aspect-square w-48 max-w-full rounded-lg border border-line bg-white object-contain p-2"
      />

      <div className="grid content-start gap-3 text-sm">
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-muted">Số tiền</dt>
          <dd className="font-semibold tabular-nums text-danger">{formatMoney(data.amount, data.currency)}</dd>
        </dl>

        <div className="grid gap-2 rounded-lg bg-surface p-3">
          <p className="flex items-center gap-2 text-xs text-muted">
            <IconQr className="size-4 text-primary" />
            Nội dung chuyển khoản
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="min-w-0 break-all rounded bg-surface-soft px-2 py-1 text-sm font-semibold text-ink">
              {instruction.transferContent}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(instruction.transferContent)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              <IconCopy className="size-3.5" />
              {copied ? "Đã sao chép" : "Sao chép"}
            </Button>
          </div>
          <p className="text-xs text-muted">Ghi đúng nội dung này để hệ thống đối soát và xác nhận đơn tự động.</p>
        </div>
      </div>
    </div>
  );
};

/**
 * What the shopper sees when an order is opened: where it stands, what was bought, what it cost, how it is paid and
 * where to collect it. The list endpoint carries no lines, so this reads the detail query the row already owns.
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
  const settledPayment = ["paid", "refunded"].includes(order.paymentStatus.toLowerCase());
  const closedOrder = ["cancelled", "completed"].includes(order.status.toLowerCase());
  const awaitingTransfer = order.paymentMethod === "sepay_qr" && !settledPayment && !closedOrder;

  return (
    <div
      id={id}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 border-t border-line bg-surface px-5 py-5 sm:px-6"
    >
      {!showSteps ? null : step !== undefined ? (
        <OrderSteps step={step} fulfillmentType={order.fulfillmentType} />
      ) : cancelled ? (
        <p className="text-sm text-muted">Đơn hàng đã huỷ.</p>
      ) : null}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 rounded-lg bg-surface-soft p-4">
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
                <div className="flex items-baseline justify-between gap-4 pt-1 text-base font-semibold text-ink">
                  <dt>Tổng cộng</dt>
                  <dd className="text-xl font-bold tabular-nums text-primary">
                    {formatMoney(Number(detail.subtotal) + Number(detail.deliveryFee), detail.currency)}
                  </dd>
                </div>
              </dl>
            </>
          ) : null}
        </section>

        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 rounded-lg bg-surface-soft p-4">
          <Heading>{order.fulfillmentType === "pickup" ? "Thông tin nhận hàng" : "Thông tin giao hàng"}</Heading>
          <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm max-sm:grid-cols-[6.5rem_minmax(0,1fr)]">
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
            {cancelled || !order.paymentMethod ? null : (
              <>
                <dt className="text-muted">Hình thức thanh toán</dt>
                <dd className="text-ink">{PAYMENT_METHOD_LABELS[order.paymentMethod]}</dd>
              </>
            )}
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

      {awaitingTransfer ? (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-lg bg-surface-soft p-4">
          <Heading>Thanh toán chuyển khoản</Heading>
          <TransferPayment orderId={order.id} />
        </section>
      ) : null}
    </div>
  );
};
