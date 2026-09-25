import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@pharmacy/ui";
import { useState } from "react";

import type { CustomerOrderDetail, PaymentInvoice } from "../../customer-api.ts";
import { formatMoney } from "../../storefront/format.ts";
import { paymentStatusBadge } from "../../storefront/order-status.ts";
import { IconCheck, IconCopy, IconQr, IconStore, IconTruck } from "../storefront/icons.tsx";

const shortCode = (id: string): string => id.slice(0, 8).toUpperCase();

type PaymentPanelProps = {
  order: CustomerOrderDetail;
  invoice: PaymentInvoice;
  paymentMethod: "sepay_qr" | "cash_on_delivery";
  storeName: string | undefined;
};

/** The order is created before the money moves, so this panel is where the shopper actually pays for it. */
export const PaymentPanel = ({ order, invoice, paymentMethod, storeName }: PaymentPanelProps): React.JSX.Element => {
  const [copied, setCopied] = useState(false);
  const payment = paymentStatusBadge(invoice.status);
  const instruction = paymentMethod === "sepay_qr" ? invoice.paymentInstruction : undefined;

  return (
    <Card id="ket-qua-dat-hang" className="border-primary/40">
      <CardHeader className="border-primary/20 bg-primary-soft/50">
        <CardTitle className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-primary text-white">
            <IconCheck className="size-4" />
          </span>
          Đã gửi đơn hàng tới nhà thuốc
        </CardTitle>
        <CardDescription>
          {paymentMethod === "sepay_qr"
            ? "Quét mã bên dưới để chuyển khoản. Đơn được xác nhận tự động khi nhà thuốc nhận đủ tiền."
            : "Bạn thanh toán cho nhân viên khi nhận thuốc. Nhà thuốc sẽ gọi xác nhận trước khi soạn."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-[190px_minmax(0,1fr)]">
        {instruction ? (
          <img
            src={instruction.qrImageUrl}
            alt="Mã QR chuyển khoản SePay cho đơn hàng"
            className="size-[190px] rounded-lg border border-line bg-white object-contain p-2"
          />
        ) : (
          <div className="grid size-[190px] place-items-center rounded-lg border border-dashed border-line bg-surface-soft p-4 text-center">
            <span className="grid gap-2 text-muted">
              {order.fulfillmentType === "pickup" ? (
                <IconStore className="mx-auto size-6" />
              ) : (
                <IconTruck className="mx-auto size-6" />
              )}
              <span className="text-xs">
                {order.fulfillmentType === "pickup" ? "Nhận và trả tiền tại nhà thuốc" : "Trả tiền khi nhận thuốc"}
              </span>
            </span>
          </div>
        )}

        <div className="grid gap-3 text-sm">
          <dl className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Mã đơn</dt>
              <dd className="font-medium text-ink">#{shortCode(order.id)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Mã thanh toán</dt>
              <dd className="font-medium text-ink">{invoice.paymentCode}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Số tiền</dt>
              <dd className="text-base font-semibold text-danger">{formatMoney(invoice.amount, invoice.currency)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Trạng thái</dt>
              <dd>
                <Badge variant={payment.variant}>{payment.label}</Badge>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">{order.fulfillmentType === "pickup" ? "Nhận tại" : "Giao tới"}</dt>
              <dd className="max-w-[60%] text-right text-ink">
                {order.fulfillmentType === "pickup"
                  ? (storeName ?? "Nhà thuốc đã chọn")
                  : (order.delivery?.providerResolvedAddress ?? "Điểm giao đã chọn")}
              </dd>
            </div>
          </dl>

          {instruction ? (
            <div className="grid gap-2 rounded-lg bg-surface-soft p-3">
              <p className="flex items-center gap-2 text-xs text-muted">
                <IconQr className="size-4 text-primary" />
                Nội dung chuyển khoản
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="rounded bg-surface px-2 py-1 text-sm font-semibold text-ink">
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
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};
