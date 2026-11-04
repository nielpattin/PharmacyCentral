import { cn } from "../cn.ts";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

// shadcn anatomy: CardHeader is a grid. The default keeps the divider; pass `border-b-0` for a header without one.

export type CardProps = DivProps & {
  /**
   * `soft` is a borderless, rounded grey surface with no divider under the header, the same family as StatTile. The
   * default keeps the bordered white card.
   */
  variant?: "default" | "soft" | undefined;
};

export const Card = ({ className, variant = "default", ...props }: CardProps): React.JSX.Element => (
  <div
    data-slot="card"
    data-variant={variant}
    className={cn(
      variant === "soft"
        ? "rounded-2xl bg-surface-soft [&_[data-slot=card-header]]:border-b-0 [&_[data-slot=card-header]]:px-5 [&_[data-slot=card-header]]:pt-5 [&_[data-slot=card-header]]:pb-1"
        : "rounded-lg border border-line bg-surface shadow-sm",
      className,
    )}
    {...props}
  />
);

export const CardHeader = ({ className, ...props }: DivProps): React.JSX.Element => (
  <div
    data-slot="card-header"
    className={cn("grid grid-cols-1 items-start border-b border-line px-5 py-4", className)}
    {...props}
  />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element => (
  <h3 data-slot="card-title" className={cn("text-base font-semibold text-ink", className)} {...props} />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element => (
  <p data-slot="card-description" className={cn("mt-1 text-sm text-muted", className)} {...props} />
);

export const CardContent = ({ className, ...props }: DivProps): React.JSX.Element => (
  <div data-slot="card-content" className={cn("px-5 py-4", className)} {...props} />
);
