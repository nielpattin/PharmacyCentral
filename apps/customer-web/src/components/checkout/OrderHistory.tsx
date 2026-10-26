import { Card, cn, Skeleton } from "@pharmacy/ui";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { ApiError, getOrder, getProduct, type CatalogStore, type CustomerOrder } from "../../customer-api.ts";
import { formatDateTime, formatMoney } from "../../storefront/format.ts";
import {
  isOrderOpen,
  orderHeadline,
  orderStatusBadge,
  orderStep,
  pickFeaturedOrder,
} from "../../storefront/order-status.ts";
import { IconPin, IconReceipt } from "../storefront/icons.tsx";
import { Link } from "../storefront/Link.tsx";
import { ProductTile } from "../storefront/ProductTile.tsx";
import { OrderDetail } from "./OrderDetail.tsx";
import { OrderSteps, OrderTrack } from "./OrderProgress.tsx";

/**
 * The list endpoint carries no lines, so a row reads its own detail to show what was bought. Only the newest rows do
 * it up front; an older one waits until the shopper opens it, which keeps a long history from firing a request each.
 */
const PREFETCH_ROWS = 10;

type Filter = "all" | "open" | "completed" | "cancelled";

const FILTERS: readonly { id: Filter; label: string; matches: (order: CustomerOrder) => boolean }[] = [
  { id: "all", label: "Tất cả", matches: () => true },
  { id: "open", label: "Đang xử lý", matches: (order) => isOrderOpen(order.status) },
  { id: "completed", label: "Hoàn tất", matches: (order) => order.status.toLowerCase() === "completed" },
  { id: "cancelled", label: "Đã huỷ", matches: (order) => order.status.toLowerCase() === "cancelled" },
];

const orderCode = (order: CustomerOrder): string => `#${order.id.slice(0, 8).toUpperCase()}`;

const orderTotal = (order: CustomerOrder): string =>
  formatMoney(Number(order.subtotal) + Number(order.deliveryFee), order.currency);

/**
 * Reads what the order holds (its lines) and the first product's photo; the product key is shared with its page.
 * `loading` is true only while a request is in flight: a failed read, an order with no lines, or a row that has not
 * been asked to load yet must show a settled fallback, never a placeholder that waits for nothing.
 */
const useOrderContents = (order: CustomerOrder, enabled: boolean) => {
  const detail = useQuery({
    queryKey: ["customer-orders", "detail", order.id],
    queryFn: () => getOrder(order.id),
    enabled,
  });
  const firstLine = detail.data?.lines?.[0];
  const product = useQuery({
    queryKey: ["product", firstLine?.productId],
    queryFn: () => getProduct(firstLine?.productId ?? ""),
    enabled: firstLine !== undefined,
  });
  return { detail, firstLine, imageUrl: product.data?.imageUrl, loading: detail.isLoading };
};

/** Stands in for the photo when the order's lines are not (yet) known; it is a settled box, not a loading shimmer. */
const PhotoFallback = ({ className }: { className: string }): React.JSX.Element => (
  <div aria-hidden="true" className={cn("flex items-center justify-center bg-surface-soft text-muted-soft", className)}>
    <IconReceipt className="size-1/3" />
  </div>
);

/** Says why the product is missing and lets the shopper ask again, so a failed read is never mistaken for loading. */
const RetryNote = ({ error, onRetry }: { error: Error | null; onRetry: () => void }): React.JSX.Element => (
  <p className="mt-1 text-sm text-muted">
    Chưa tải được sản phẩm của đơn{error instanceof ApiError ? ` (mã ${error.status})` : ""}.{" "}
    <button
      type="button"
      onClick={onRetry}
      className="font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      Thử lại
    </button>
  </p>
);

const Chevron = ({ open }: { open: boolean }): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")}
  >
    <path d="m6 9.5 6 6 6-6" />
  </svg>
);

const EmptyOrders = (): React.JSX.Element => (
  <div className="flex flex-col items-start gap-3 py-10">
    <div>
      <p className="text-base font-semibold text-ink">Bạn chưa có đơn hàng nào</p>
      <p className="mt-1 max-w-md text-sm text-muted">
        Sau khi đặt hàng, đơn sẽ xuất hiện ở đây để bạn theo dõi việc lấy thuốc, thanh toán và giao hàng.
      </p>
    </div>
    <Link
      href="/"
      className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-white outline-none hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      Chọn thuốc và đặt hàng
    </Link>
  </div>
);

/** The order the shopper most likely came for: large, image-led, with the status said in a sentence. */
const FeaturedOrder = ({
  order,
  store,
}: {
  order: CustomerOrder;
  store: CatalogStore | undefined;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const { detail, firstLine, imageUrl, loading } = useOrderContents(order, true);
  const step = orderStep(order.status);
  const cancelled = order.status.toLowerCase() === "cancelled";
  const delivery = order.fulfillmentType === "delivery";
  const lines = detail.data?.lines;
  const deliveryAddress = detail.data?.delivery?.providerResolvedAddress;
  const failedPayment = !cancelled && order.paymentStatus.toLowerCase() === "failed";

  return (
    <Card className="min-w-0 overflow-hidden border-0">
      <div className="bg-gradient-to-r from-primary-soft to-surface px-5 py-4 sm:px-8">
        <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-muted">
          <span>
            Mã đơn <span className="ml-1 text-base font-semibold tabular-nums text-ink">{orderCode(order)}</span>
          </span>
          <span>Đặt lúc {formatDateTime(order.createdAt)}</span>
        </p>
        <h2 className="mt-2 text-balance text-lg font-semibold text-ink">{orderHeadline(order)}</h2>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 p-5 sm:p-8 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-10">
        <div className="mx-auto w-full max-w-64 md:mx-0">
          {firstLine ? (
            <ProductTile
              name={firstLine.productNameSnapshot}
              seed={firstLine.productId}
              imageUrl={imageUrl}
              monogramClassName="text-5xl"
              className={cn("w-full rounded-xl bg-surface-soft p-2", cancelled && "opacity-60")}
            />
          ) : loading ? (
            <Skeleton className="aspect-square w-full" />
          ) : (
            <PhotoFallback className="aspect-square w-full rounded-xl" />
          )}
        </div>

        <div className="min-w-0">
          {firstLine ? (
            <p className="mt-2 text-lg leading-snug text-ink">
              {firstLine.productNameSnapshot}
              {lines && lines.length > 1 ? ` và ${lines.length - 1} sản phẩm khác` : ""}
            </p>
          ) : loading ? (
            <Skeleton className="mt-3 h-6 w-2/3" />
          ) : detail.isError ? (
            <RetryNote error={detail.error} onRetry={() => void detail.refetch()} />
          ) : null}

          {step !== undefined ? (
            <div className="mt-6">
              <OrderSteps step={step} fulfillmentType={order.fulfillmentType} />
            </div>
          ) : null}

          {cancelled ? null : (
            <div className="mt-6 flex items-start gap-2.5 text-base text-ink">
              <IconPin className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                {delivery ? (
                  <>
                    <p className="font-medium">Giao tận nơi</p>
                    {deliveryAddress ? <p className="text-sm text-muted">{deliveryAddress}</p> : null}
                  </>
                ) : store ? (
                  <>
                    <p className="font-medium">
                      {isOrderOpen(order.status) ? "Đến nhận tại" : "Nhận tại"} {store.name}
                    </p>
                    {store.address ? <p className="text-sm text-muted">{store.address}</p> : null}
                  </>
                ) : (
                  <p className="font-medium">Nhận tại nhà thuốc</p>
                )}
              </div>
            </div>
          )}
          {failedPayment ? <p className="mt-3 text-sm font-medium text-danger-ink">Thanh toán lỗi</p> : null}

          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted">Tổng cộng</p>
              <p className="text-xl font-bold tabular-nums text-primary">{orderTotal(order)}</p>
            </div>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? detailId : undefined}
              onClick={() => setOpen((current) => !current)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-white outline-none hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
            >
              {open ? "Thu gọn chi tiết" : "Xem chi tiết đơn"}
              <Chevron open={open} />
            </button>
          </div>
        </div>
      </div>
      {open ? <OrderDetail id={detailId} order={order} store={store} query={detail} showSteps={false} /> : null}
    </Card>
  );
};

const OrderRow = ({
  order,
  store,
  index,
}: {
  order: CustomerOrder;
  store: CatalogStore | undefined;
  index: number;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const { detail, firstLine, imageUrl, loading } = useOrderContents(order, open || index < PREFETCH_ROWS);
  const status = orderStatusBadge(order.status);
  const step = orderStep(order.status);
  const cancelled = order.status.toLowerCase() === "cancelled";
  const completed = order.status.toLowerCase() === "completed";
  const lines = detail.data?.lines;

  return (
    <li className="min-w-0 overflow-hidden rounded-lg bg-surface shadow-sm transition-shadow hover:shadow-md motion-reduce:transition-none">
      <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:gap-x-5">
        <div aria-hidden="true" className="size-16">
          {firstLine ? (
            <ProductTile
              name={firstLine.productNameSnapshot}
              seed={firstLine.productId}
              imageUrl={imageUrl}
              monogramClassName="text-xl"
              className={cn("size-16 rounded-lg bg-surface", cancelled && "opacity-60")}
            />
          ) : loading ? (
            <Skeleton className="size-16" />
          ) : (
            <PhotoFallback className="size-16 rounded-lg" />
          )}
        </div>

        <div className="min-w-0">
          {firstLine ? (
            <h3
              className={cn(
                "line-clamp-2 text-base text-ink",
                completed || cancelled ? "font-medium" : "font-semibold",
              )}
            >
              {firstLine.productNameSnapshot}
              {lines && lines.length > 1 ? ` và ${lines.length - 1} sản phẩm khác` : ""}
            </h3>
          ) : loading ? (
            <Skeleton className="h-5 w-2/3" />
          ) : (
            <h3 className="text-base font-semibold text-ink">Đơn {orderCode(order)}</h3>
          )}
          <p className="mt-1 flex items-center gap-2 text-sm text-ink">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                cancelled ? "ring-[1.5px] ring-muted-soft ring-inset" : completed ? "bg-muted" : "bg-primary",
              )}
            />
            {status.label}
            <span className="text-muted">· {formatDateTime(order.createdAt)}</span>
          </p>
          {detail.isError ? <RetryNote error={detail.error} onRetry={() => void detail.refetch()} /> : null}
          {step !== undefined && !completed ? <OrderTrack step={step} fulfillmentType={order.fulfillmentType} /> : null}
        </div>

        <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end">
          <p className="text-base font-semibold tabular-nums text-ink">{orderTotal(order)}</p>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? detailId : undefined}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-surface-soft px-3 text-sm font-medium text-ink outline-none hover:bg-line focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {open ? "Thu gọn" : "Chi tiết"}
            <Chevron open={open} />
          </button>
        </div>
      </div>
      {open ? <OrderDetail id={detailId} order={order} store={store} query={detail} /> : null}
    </li>
  );
};

export const OrderHistory = ({
  orders,
  stores,
}: {
  orders: CustomerOrder[];
  stores: CatalogStore[];
}): React.JSX.Element => {
  const [filter, setFilter] = useState<Filter>("all");
  const featured = pickFeaturedOrder(orders);
  if (!featured) return <EmptyOrders />;

  const storeOf = (order: CustomerOrder): CatalogStore | undefined =>
    stores.find((candidate) => candidate.id === order.selectedStoreId);
  const others = orders
    .filter((order) => order.id !== featured.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const active = FILTERS.find((candidate) => candidate.id === filter) ?? FILTERS[0];
  const shown = others.filter((order) => active?.matches(order) ?? true);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
      <FeaturedOrder order={featured} store={storeOf(featured)} />

      {others.length > 0 ? (
        <section aria-labelledby="other-orders" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="other-orders" className="text-xl font-semibold text-ink">
              Các đơn khác
            </h2>
            <div
              role="group"
              aria-label="Lọc đơn hàng"
              className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-surface-soft p-1"
            >
              {FILTERS.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  aria-pressed={candidate.id === filter}
                  onClick={() => setFilter(candidate.id)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    candidate.id === filter
                      ? "bg-surface font-semibold text-ink shadow-sm"
                      : "font-medium text-muted hover:text-ink",
                  )}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
          </div>
          {shown.length > 0 ? (
            <ul className="grid min-w-0 gap-3">
              {shown.map((order, index) => (
                <OrderRow key={order.id} order={order} store={storeOf(order)} index={index} />
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-muted">Chưa có đơn nào trong mục này.</p>
          )}
        </section>
      ) : null}
    </div>
  );
};
