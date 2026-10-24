import { cn } from "../cn.ts";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

// shadcn anatomy: CardHeader is a grid. The default keeps the divider; pass `border-b-0` for a header without one.

export const Card = ({ className, ...props }: DivProps): React.JSX.Element => (
  <div data-slot="card" className={cn("rounded-lg border border-line bg-surface shadow-sm", className)} {...props} />
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
