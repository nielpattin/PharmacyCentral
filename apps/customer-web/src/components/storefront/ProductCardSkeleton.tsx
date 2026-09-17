import { cn } from "@pharmacy/ui";

export const ProductCardSkeleton = (): React.JSX.Element => (
  <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
    <div className="aspect-square animate-pulse rounded-md bg-surface-soft" />
    <div className="space-y-2">
      <div className="h-3.5 w-full animate-pulse rounded bg-surface-soft" />
      <div className="h-3.5 w-3/5 animate-pulse rounded bg-surface-soft" />
    </div>
    <div className="mt-auto space-y-2">
      <div className="h-4 w-2/5 animate-pulse rounded bg-surface-soft" />
      <div className="h-8 w-full animate-pulse rounded-md bg-surface-soft" />
    </div>
  </div>
);

export const ProductGridSkeleton = ({
  count = 8,
  className,
}: {
  count?: number | undefined;
  className?: string | undefined;
}): React.JSX.Element => (
  <div
    className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", className)}
    aria-busy="true"
    aria-live="polite"
  >
    {Array.from({ length: count }, (_, index) => (
      <ProductCardSkeleton key={index} />
    ))}
  </div>
);
