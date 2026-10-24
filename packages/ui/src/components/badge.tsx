import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.ts";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      primary: "bg-primary-soft text-primary-dark",
      secondary: "bg-surface-soft text-muted",
      outline: "border border-line text-muted",
      danger: "bg-danger-soft text-danger",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
    },
  },
  defaultVariants: { variant: "primary" },
});

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export const Badge = ({ className, variant, ...props }: BadgeProps): React.JSX.Element => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);
