import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.ts";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white hover:bg-primary-dark",
        secondary: "bg-surface-soft text-ink hover:bg-line",
        outline: "border border-line bg-surface text-ink hover:bg-surface-soft",
        ghost: "text-ink hover:bg-surface-soft",
        danger: "bg-danger text-white hover:brightness-95",
        "danger-soft": "bg-danger-soft text-danger-ink hover:bg-danger/15",
        // Quiet until hovered, for a destructive action repeated on every table row.
        "danger-ghost": "text-danger-ink hover:bg-danger-soft",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export const Button = ({ className, variant, size, type = "button", ...props }: ButtonProps): React.JSX.Element => (
  <button
    type={type}
    data-weight="press"
    data-variant={variant ?? "primary"}
    data-size={size ?? "md"}
    className={cn(buttonVariants({ variant, size }), className)}
    {...props}
  />
);
