import { useState } from "react";

import { cn } from "@pharmacy/ui";

import { initials } from "../../storefront/format.ts";
import { tileTone } from "../../storefront/catalog.ts";

export const ProductTile = ({
  name,
  seed,
  imageUrl,
  className,
  monogramClassName,
}: {
  name: string;
  seed: string;
  imageUrl?: string | null | undefined;
  className?: string | undefined;
  monogramClassName?: string | undefined;
}): React.JSX.Element => {
  const [failedImageUrl, setFailedImageUrl] = useState<string | undefined>(undefined);
  const imageSrc = imageUrl ?? undefined;
  const showImage = Boolean(imageSrc && imageSrc !== failedImageUrl);

  return (
    <div
      className={cn(
        "relative grid aspect-square place-items-center overflow-hidden rounded-md border border-line/60",
        tileTone(seed),
        className,
      )}
    >
      {showImage ? (
        <img
          src={imageSrc}
          alt={name}
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setFailedImageUrl(imageSrc)}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn("font-semibold tracking-tight text-primary-dark/75", monogramClassName ?? "text-3xl")}
        >
          {initials(name)}
        </span>
      )}
    </div>
  );
};
