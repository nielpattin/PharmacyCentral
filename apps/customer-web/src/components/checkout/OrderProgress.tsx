import { cn } from "@pharmacy/ui";

import { orderStepLabels } from "../../storefront/order-status.ts";

/** Segments up to and including the current step are filled; the rest stay empty. The current one carries a halo. */
const segmentClass = (index: number, step: number): string =>
  cn(index <= step ? "bg-primary" : "bg-line", index === step && "ring-4 ring-primary-soft");

/** Five slim segments under an order row. The label for assistive tech names the current step. */
export const OrderTrack = ({
  step,
  fulfillmentType,
}: {
  step: number;
  fulfillmentType: "pickup" | "delivery";
}): React.JSX.Element => {
  const labels = orderStepLabels(fulfillmentType);
  return (
    <div
      role="img"
      aria-label={`Tiến trình: ${labels[step]}, bước ${step + 1} trên ${labels.length}`}
      className="mt-2 flex max-w-md gap-1.5 py-1"
    >
      {labels.map((label, index) => (
        <span key={label} className={cn("h-1.5 flex-1 rounded-full", segmentClass(index, step))} />
      ))}
    </div>
  );
};

/** The same five segments with a label under each, for the opened order. */
export const OrderSteps = ({
  step,
  fulfillmentType,
}: {
  step: number;
  fulfillmentType: "pickup" | "delivery";
}): React.JSX.Element => (
  <ol aria-label="Các bước xử lý đơn hàng" className="grid grid-cols-5 gap-1.5 p-1">
    {orderStepLabels(fulfillmentType).map((label, index) => (
      <li
        key={label}
        aria-current={index === step ? "step" : undefined}
        className={cn("grid gap-2.5 text-xs leading-tight", index === step ? "font-semibold text-ink" : "text-muted")}
      >
        <span className={cn("h-1.5 rounded-full", segmentClass(index, step))} />
        {label}
      </li>
    ))}
  </ol>
);
