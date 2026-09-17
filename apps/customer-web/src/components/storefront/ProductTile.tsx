import { cn } from "@pharmacy/ui";

import { initials } from "../../storefront/format.ts";
import { tileTone } from "../../storefront/catalog.ts";

export const ProductTile = ({
  name,
  seed,
  className,
  monogramClassName,
}: {
  name: string;
  seed: string;
  className?: string | undefined;
  monogramClassName?: string | undefined;
}): React.JSX.Element => (
  <div
    className={cn(
      "relative grid aspect-square place-items-center overflow-hidden rounded-md border border-line/60",
      tileTone(seed),
      className,
    )}
    aria-hidden="true"
  >
    <span className={cn("font-semibold tracking-tight text-primary-dark/75", monogramClassName ?? "text-3xl")}>
      {initials(name)}
    </span>
  </div>
);
