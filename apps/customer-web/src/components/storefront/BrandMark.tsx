import { cn } from "@pharmacy/ui";

export const BrandMark = ({ className }: { className?: string }): React.JSX.Element => (
  <span className={cn("block shrink-0 overflow-hidden rounded-xl", className)} aria-hidden="true">
    <img className="size-full object-contain" src="/brandmark.png" alt="" />
  </span>
);
