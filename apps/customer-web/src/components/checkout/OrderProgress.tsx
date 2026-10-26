import { cn } from "@pharmacy/ui";

import { orderStepLabels } from "../../storefront/order-status.ts";

/** Segments up to and including the current step are filled; the rest stay empty. */
const segmentClass = (index: number, step: number): string => (index <= step ? "bg-primary" : "bg-line");

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
      className="mt-3 flex max-w-md gap-1.5"
    >
      {labels.map((label, index) => (
        <span key={label} className={cn("h-1.5 flex-1 rounded-sm", segmentClass(index, step))} />
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
  <ol aria-label="Các bước xử lý đơn hàng" className="grid grid-cols-5 gap-1.5">
    {orderStepLabels(fulfillmentType).map((label, index) => (
      <li
        key={label}
        aria-current={index === step ? "step" : undefined}
        className={cn(
          "grid gap-2 text-sm max-sm:text-xs max-sm:leading-tight",
          index === step ? "font-semibold text-primary-dark" : "text-muted",
        )}
      >
        <span className={cn("h-2 rounded-full", segmentClass(index, step))} />
        {label}
      </li>
    ))}
  </ol>
);
