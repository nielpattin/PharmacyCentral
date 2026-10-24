import { cn } from "../cn.ts";

export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div
    data-slot="skeleton"
    aria-hidden="true"
    className={cn("animate-pulse rounded-md bg-line motion-reduce:animate-none", className)}
    {...props}
  />
);
