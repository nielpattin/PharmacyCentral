import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.ts";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

// Ant Design Tag, solid variant (4px radius, 12px/20px, no border) in the project's own status colours: white text on the
// deep fills, ink on the amber one, each at least 4.5:1 for its 12px text. Chart colours never signal status.
const statusBadgeVariants = cva("inline-flex items-center rounded-sm px-[7px] text-xs leading-5 whitespace-nowrap", {
  variants: {
    tone: {
      success: "bg-success text-white",
      warning: "bg-warning-edge text-ink",
      danger: "bg-danger-ink text-white",
      info: "bg-primary text-white",
      neutral: "bg-muted text-white",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type StatusBadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof statusBadgeVariants>;

/** Status label. The text carries the meaning; the colour only marks the tone. */
export const StatusBadge = ({ tone, className, children, ...props }: StatusBadgeProps): React.JSX.Element => (
  <span data-tone={tone ?? "neutral"} className={cn(statusBadgeVariants({ tone }), className)} {...props}>
    {children}
  </span>
);
