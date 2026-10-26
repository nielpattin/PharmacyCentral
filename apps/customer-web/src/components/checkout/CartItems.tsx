import { Badge, Button, cn } from "@pharmacy/ui";
import { useState } from "react";

import type { CheckoutLine } from "../../storefront/checkout.ts";
import { formatMoney } from "../../storefront/format.ts";
import { Link } from "../storefront/Link.tsx";
import { ProductTile } from "../storefront/ProductTile.tsx";
import { IconCart, IconMinus, IconPlus, IconTrash } from "../storefront/icons.tsx";

type QuantityStepperProps = {
  quantity: number;
  productName: string;
  disabled: boolean;
  pending: boolean;
  onChange: (quantity: number) => void;
};

/**
 * The quantity field stays uncontrolled and is remounted by `key` whenever the server value changes, so a slow
 * round trip can never leave the box showing a number the cart does not hold. Rejected input (empty, 0, fractional)
 * bumps `resetToken` to remount the field with the value the cart actually has.
 */
const QuantityStepper = ({
  quantity,
  productName,
  disabled,
  pending,
  onChange,
}: QuantityStepperProps): React.JSX.Element => {
  const [resetToken, setResetToken] = useState(0);

  const commit = (raw: string): void => {
    const next = Number(raw);
    if (!Number.isInteger(next) || next < 1) {
      setResetToken((token) => token + 1);
      return;
    }
    if (next !== quantity) onChange(next);
  };

  const stepClass =
    "grid size-8 place-items-center text-muted transition-colors hover:text-primary disabled:pointer-events-none disabled:opacity-40 max-sm:size-10";

  return (
    <div className={cn("flex h-10 items-center rounded-full border border-line bg-surface", pending && "opacity-60")}>
      <button
        type="button"
        className={stepClass}
        aria-label={`Giảm số lượng ${productName}`}
        disabled={disabled || quantity <= 1}
        onClick={() => onChange(quantity - 1)}
      >
        <IconMinus className="size-4" />
      </button>
      <input
        key={`${quantity}:${resetToken}`}
        type="number"
        min={1}
        inputMode="numeric"
        defaultValue={quantity}
        disabled={disabled}
        aria-label={`Số lượng ${productName}`}
        className="h-full w-12 border-x border-line bg-transparent text-center text-sm text-ink outline-none [appearance:textfield] disabled:opacity-60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onBlur={(event) => commit(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className={stepClass}
        aria-label={`Tăng số lượng ${productName}`}
        disabled={disabled}
        onClick={() => onChange(quantity + 1)}
      >
        <IconPlus className="size-4" />
      </button>
    </div>
  );
};

type CartItemsProps = {
  lines: CheckoutLine[];
  pendingLineId: string | undefined;
  busy: boolean;
  onQuantityChange: (line: CheckoutLine, quantity: number) => void;
  onRemove: (line: CheckoutLine) => void;
  onBrowse: () => void;
};

export const CartItems = ({
  lines,
  pendingLineId,
  busy,
  onQuantityChange,
  onRemove,
  onBrowse,
}: CartItemsProps): React.JSX.Element => {
  if (lines.length === 0) {
    return (
      <div className="grid place-items-center gap-3 rounded-lg border border-dashed border-line bg-surface-soft/60 px-6 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-surface text-muted-soft">
          <IconCart className="size-6" />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">Giỏ thuốc của bạn đang trống</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Chọn thuốc hoặc vật tư y tế bên dưới để thêm vào đơn, sau đó chọn cách nhận hàng và đặt hàng.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onBrowse}>
          Chọn thuốc
        </Button>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {lines.map((line) => {
        const pending = pendingLineId === line.id;
        return (
          <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4">
            <Link className="shrink-0" href={`/san-pham/${line.productId}`}>
              <ProductTile
                name={line.productName}
                seed={line.sku ?? line.productId}
                imageUrl={line.imageUrl}
                className="size-20"
                monogramClassName="text-lg"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                className="line-clamp-2 text-[15px] font-medium text-ink hover:text-primary"
                href={`/san-pham/${line.productId}`}
              >
                {line.productName}
              </Link>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                {line.unitName ? `${line.unitName} · ` : ""}
                {line.sku ? `SKU ${line.sku}` : "Đơn vị bán theo nhà thuốc"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-primary">
                  {line.unitPrice === undefined ? "Liên hệ báo giá" : formatMoney(line.unitPrice, line.currency)}
                </span>
                {line.unitName && line.unitPrice !== undefined ? (
                  <span className="text-xs text-muted">/ {line.unitName}</span>
                ) : null}
                {line.available === false ? <Badge variant="danger">Có thể hết hàng</Badge> : null}
              </div>
            </div>
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
              <div className="flex items-center gap-1.5">
                <QuantityStepper
                  quantity={line.quantity}
                  productName={line.productName}
                  disabled={busy || pending}
                  pending={pending}
                  onChange={(quantity) => onQuantityChange(line, quantity)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted hover:bg-danger-soft hover:text-danger-ink max-sm:min-h-10 max-sm:min-w-10"
                  aria-label={`Xoá ${line.productName} khỏi giỏ`}
                  disabled={busy || pending}
                  onClick={() => onRemove(line)}
                >
                  <IconTrash className="size-4" />
                </Button>
              </div>
              <p className="w-24 shrink-0 text-right text-sm font-bold text-ink max-sm:w-auto max-sm:min-w-0 max-sm:shrink">
                {line.lineTotal === undefined ? "—" : formatMoney(line.lineTotal, line.currency)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
