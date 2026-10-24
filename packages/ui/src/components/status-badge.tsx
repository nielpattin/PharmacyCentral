import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.ts";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

// Every tone maps to an existing theme token. `accent` uses the chart-3 identity colour, never a raw hex value.
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        info: "bg-primary-soft text-primary-dark",
        neutral: "bg-surface-soft text-muted ring-1 ring-line",
        accent: "bg-chart-3/10 text-chart-3",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type StatusBadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof statusBadgeVariants>;

/** Status label. The text carries the meaning; the dot only reinforces the tone. */
export const StatusBadge = ({ tone, className, children, ...props }: StatusBadgeProps): React.JSX.Element => (
  <span data-tone={tone ?? "neutral"} className={cn(statusBadgeVariants({ tone }), className)} {...props}>
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
    {children}
  </span>
);
