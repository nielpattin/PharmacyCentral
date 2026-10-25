import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.ts";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

// Every tone maps to a semantic theme token and keeps at least 4.5:1 for its 12px text. Chart colours never signal status.
const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger-ink",
        info: "bg-primary-soft text-primary-dark",
        neutral: "bg-surface-soft text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type StatusBadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof statusBadgeVariants>;

/** Status label. The text carries the meaning; the colour only marks the tone. */
export const StatusBadge = ({ tone, className, children, ...props }: StatusBadgeProps): React.JSX.Element => (
  <span data-tone={tone ?? "neutral"} className={cn(statusBadgeVariants({ tone }), className)} {...props}>
    {children}
  </span>
);

/**
 * Status inside a list or table cell. Colour is kept for what needs a look (warning, danger, info); the settled
 * states, `success` and `neutral`, are plain text so a column of mostly-done rows stays calm.
 */
export const StatusCell = ({ tone, className, children, ...props }: StatusBadgeProps): React.JSX.Element =>
  tone === undefined || tone === "success" || tone === "neutral" ? (
    <span
      data-tone={tone ?? "neutral"}
      className={cn("text-sm", tone === "success" ? "text-ink" : "text-muted", className)}
      {...props}
    >
      {children}
    </span>
  ) : (
    <StatusBadge tone={tone} className={className} {...props}>
      {children}
    </StatusBadge>
  );
