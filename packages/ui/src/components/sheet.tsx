import { useCallback, useId } from "react";

import { cn } from "../cn.ts";

export type SheetWidth = "md" | "lg" | "xl";

const WIDTH_CLASS: Record<SheetWidth, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  /** Accessible name of the close button. Pass translated text. */
  closeLabel: string;
  children: React.ReactNode;
  width?: SheetWidth | undefined;
  className?: string | undefined;
};

/**
 * Right-side drawer. Escape and the backdrop close it, Tab stays inside it, body scroll is locked while it is open,
 * and focus returns to the element that was focused before it opened.
 */
export const Sheet = ({
  open,
  onClose,
  title,
  description,
  closeLabel,
  children,
  width = "lg",
  className,
}: SheetProps): React.JSX.Element | null => {
  const titleId = useId();
  const descriptionId = useId();

  // Ref callback instead of an effect: it runs when the panel mounts and its returned cleanup runs when it unmounts.
  const panelRef = useCallback((panel: HTMLDivElement | null) => {
    if (panel === null) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    panel.focus();
    return () => {
      body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items.at(0);
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-full w-full flex-col border-l border-line bg-surface shadow-lg outline-none motion-safe:animate-sheet-in",
          WIDTH_CLASS[width],
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="grid min-w-0 gap-1">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted outline-none hover:bg-surface-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
};
