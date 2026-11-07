import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.ts";

// Styled after Ant Design's Button (ant.design/components/button): 32px default height, 6px radius, a 1px neutral
// border and a faint bottom shadow on the filled and bordered types, text and link types with no box, and a hover that
// lifts the colour rather than darkening it. `outline` is Ant's default type, `ghost` its text type.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-normal transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-white shadow-[0_2px_0_oklch(0.52_0.18_256/0.1)] hover:bg-primary/85 active:bg-primary-dark",
        // Ant's filled type: a faint grey box with no border.
        secondary: "bg-ink/5 text-ink hover:bg-ink/10 active:bg-ink/15",
        outline:
          "border border-[oklch(0.87_0.004_260)] bg-surface text-ink shadow-[0_2px_0_rgb(0_0_0/0.02)] hover:border-primary/70 hover:text-primary/80 active:border-primary-dark active:text-primary-dark",
        // Ant's text type: no box until hovered.
        ghost: "text-ink hover:bg-ink/6 active:bg-ink/10",
        // Ant's link type.
        link: "text-primary hover:text-primary/75 active:text-primary-dark",
        danger: "bg-danger text-white shadow-[0_2px_0_rgb(0_0_0/0.04)] hover:bg-danger/85 active:brightness-90",
        "danger-soft": "bg-danger-soft text-danger-ink hover:bg-danger/15 active:bg-danger/25",
        // A destructive action repeated on every table row: Ant's danger text type.
        "danger-ghost": "text-danger-ink hover:bg-danger-soft active:bg-danger/20",
      },
      size: {
        sm: "h-7 rounded-sm px-2.5 text-sm",
        md: "h-8 rounded-md px-[15px] text-sm",
        lg: "h-10 rounded-lg px-[15px] text-base",
        icon: "h-8 w-8 rounded-md",
        "icon-sm": "size-7 rounded-sm",
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
