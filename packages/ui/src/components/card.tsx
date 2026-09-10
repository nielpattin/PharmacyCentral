import { cn } from "../cn.ts";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export const Card = ({ className, ...props }: DivProps): React.JSX.Element => (
  <div className={cn("rounded-lg border border-line bg-surface shadow-sm", className)} {...props} />
);

export const CardHeader = ({ className, ...props }: DivProps): React.JSX.Element => (
  <div className={cn("border-b border-line px-5 py-4", className)} {...props} />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element => (
  <h3 className={cn("text-base font-semibold text-ink", className)} {...props} />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element => (
  <p className={cn("mt-1 text-sm text-muted", className)} {...props} />
);

export const CardContent = ({ className, ...props }: DivProps): React.JSX.Element => (
  <div className={cn("px-5 py-4", className)} {...props} />
);

export const CardFooter = ({ className, ...props }: DivProps): React.JSX.Element => (
  <div className={cn("flex items-center gap-2 border-t border-line px-5 py-3", className)} {...props} />
);
