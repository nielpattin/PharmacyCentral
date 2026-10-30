import { useId, useState } from "react";

import { cn } from "../cn.ts";

export type DisclosureProps = {
  closedLabel: string;
  openLabel: string;
  className?: string | undefined;
  children: React.ReactNode;
};

/** A toggle button that reveals a panel below it. The panel is only mounted while open. */
export const Disclosure = ({ closedLabel, openLabel, className, children }: DisclosureProps): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        data-weight="press"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary-dark outline-none transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {open ? openLabel : closedLabel}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
        >
          <path d="m6 9.5 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div id={panelId} className="mt-1">
          {children}
        </div>
      ) : null}
    </div>
  );
};
