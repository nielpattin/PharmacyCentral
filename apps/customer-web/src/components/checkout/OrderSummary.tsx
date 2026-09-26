import { Button, Card, CardContent, CardHeader, CardTitle } from "@pharmacy/ui";

import type { CheckoutLine, CheckoutTotals } from "../../storefront/checkout.ts";
import { formatMoney, formatQuantity } from "../../storefront/format.ts";
import { Link } from "../storefront/Link.tsx";
import { IconQr, IconShield, IconTruck } from "../storefront/icons.tsx";

const AmountRow = ({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.JSX.Element => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className={strong ? "text-sm font-semibold text-ink" : "text-sm text-muted"}>{label}</dt>
    <dd className={strong ? "text-lg font-semibold text-danger" : "text-sm font-medium text-ink"}>{value}</dd>
  </div>
);

const TRUST_POINTS = [
  { icon: <IconShield />, label: "Thuốc chính hãng, có hoá đơn" },
  { icon: <IconTruck />, label: "Giao tận nơi hoặc nhận tại nhà thuốc" },
  { icon: <IconQr />, label: "Chuyển khoản QR hoặc trả khi nhận hàng" },
];

type OrderSummaryProps = {
  lines: CheckoutLine[];
  totals: CheckoutTotals;
  fulfillmentType: "pickup" | "delivery";
  destinationLabel: string | undefined;
  storeName: string | undefined;
  shippingKnown: boolean;
  busy: boolean;
  canSubmit: boolean;
  blockedReason: string | undefined;
  /** True when the only thing standing between the shopper and an order is signing in. */
  needsAccount: boolean;
  onSubmit: () => void;
  onGoToCart: () => void;
};
export const OrderSummary = ({
  lines,
  totals,
  fulfillmentType,
  destinationLabel,
  storeName,
  shippingKnown,
  busy,
  canSubmit,
  blockedReason,
  needsAccount,
  onSubmit,
  onGoToCart,
}: OrderSummaryProps): React.JSX.Element => {
  const currency = totals.currency;
  const shippingValue = !shippingKnown
    ? fulfillmentType === "pickup"
      ? "Không phí"
      : "Tính khi đặt hàng"
    : totals.shippingFee
      ? formatMoney(totals.shippingFee, currency)
      : "Miễn phí";

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>Đơn hàng của bạn</CardTitle>
        <span className="text-xs text-muted">{totals.productCount} sản phẩm</span>
      </CardHeader>
      <CardContent className="grid gap-4">
        {lines.length === 0 ? (
          <div className="grid gap-3">
            <p className="rounded-md bg-surface-soft px-3 py-4 text-center text-sm text-muted">
              Chưa có sản phẩm nào trong giỏ. Chọn thuốc để bắt đầu đơn hàng.
            </p>
            <Button size="lg" className="w-full" onClick={onGoToCart}>
              Chọn thuốc vào giỏ
            </Button>
          </div>
        ) : (
          <>
            <ul className="grid max-h-64 gap-2.5 overflow-y-auto pr-1 text-sm">
              {lines.map((line) => (
                <li key={line.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-ink">{line.productName}</span>
                    <span className="text-muted">
                      {" × "}
                      {formatQuantity(line.quantity)}
                      {line.unitName ? ` ${line.unitName}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-ink">
                    {line.lineTotal === undefined ? "—" : formatMoney(line.lineTotal, line.currency)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="grid gap-2.5 border-t border-line pt-4">
              <AmountRow label="Tạm tính" value={formatMoney(totals.subtotal, currency)} />
              <AmountRow label="Phí giao hàng" value={shippingValue} />
              <div className="border-t border-line pt-3">
                <AmountRow label="Tổng cộng" value={formatMoney(totals.total, currency)} strong />
              </div>
            </dl>

            <div className="grid gap-1 text-xs text-muted">
              <p>
                {fulfillmentType === "pickup"
                  ? `Nhận tại: ${storeName ?? "nhà thuốc đang chọn"}`
                  : `Giao đến: ${destinationLabel ?? "chọn điểm giao bên dưới"}`}
              </p>
              {totals.unpricedCount > 0 ? (
                <p className="text-danger">
                  {totals.unpricedCount} sản phẩm chưa có giá niêm yết. Hệ thống sẽ báo giá khi xác nhận đơn.
                </p>
              ) : null}
              <p>Giá và phí giao hàng được hệ thống tính lại khi bạn xác nhận đặt hàng.</p>
            </div>

            <Button size="lg" className="w-full" disabled={!canSubmit || busy} onClick={onSubmit}>
              {busy ? "Đang xử lý…" : "Đặt hàng"}
            </Button>

            {blockedReason ? (
              needsAccount ? (
                <p className="-mt-2 text-center text-xs text-muted">
                  {blockedReason}{" "}
                  <Link className="font-medium text-primary hover:underline" href="/tai-khoan">
                    Đăng nhập
                  </Link>
                </p>
              ) : (
                <p className="-mt-2 text-center text-xs text-muted">{blockedReason}</p>
              )
            ) : null}
          </>
        )}

        <ul className="grid gap-2 border-t border-line pt-4 text-xs text-muted">
          {TRUST_POINTS.map((point) => (
            <li key={point.label} className="flex items-center gap-2">
              <span className="text-primary">{point.icon}</span>
              {point.label}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
