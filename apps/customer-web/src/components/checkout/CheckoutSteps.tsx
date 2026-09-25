import { cn } from "@pharmacy/ui";

import { IconCheck } from "../storefront/icons.tsx";

export type CheckoutStep = 1 | 2 | 3;

const STEPS: Array<{ step: CheckoutStep; label: string }> = [
  { step: 1, label: "Giỏ thuốc" },
  { step: 2, label: "Nhận hàng & thanh toán" },
  { step: 3, label: "Hoàn tất" },
];

export const CheckoutSteps = ({ current }: { current: CheckoutStep }): React.JSX.Element => (
  <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Các bước đặt hàng">
    {STEPS.map(({ step, label }, index) => {
      const done = step < current;
      const active = step === current;
      return (
        <li key={step} className="flex flex-none items-center gap-3 sm:flex-1 sm:last:flex-none">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                done ? "border-primary bg-primary text-white" : null,
                active ? "border-primary bg-primary-soft text-primary-dark" : null,
                !done && !active ? "border-line bg-surface text-muted-soft" : null,
              )}
            >
              {done ? <IconCheck className="size-3.5" /> : step}
            </span>
            <span
              className={cn(
                "whitespace-nowrap text-xs sm:text-sm",
                active ? "font-semibold text-ink" : done ? "text-muted" : "text-muted-soft",
              )}
              {...(active ? { "aria-current": "step" as const } : {})}
            >
              {label}
            </span>
          </span>
          {index < STEPS.length - 1 ? (
            <span aria-hidden="true" className="hidden h-px min-w-4 flex-1 bg-line sm:block" />
          ) : null}
        </li>
      );
    })}
  </ol>
);
