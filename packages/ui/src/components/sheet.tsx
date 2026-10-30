import { useId, useRef } from "react";

import { cn } from "../cn.ts";
import { handleModalKeyDown, modalPanelRef } from "../modal.ts";
import { usePresence } from "../presence.ts";

export type SheetWidth = "md" | "lg" | "xl";

const WIDTH_CLASS: Record<SheetWidth, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

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
 * and focus returns to the element that was focused before it opened. On close it slides out, showing what it last
 * showed, before it unmounts.
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
  const presence = usePresence(open);
  // While the exit animation plays the parent has usually cleared what the drawer showed; keep the last content.
  const shown = useRef({ title, description, children });
  if (open) shown.current = { title, description, children };

  if (!presence.mounted) return null;

  return (
    <div
      data-weight="backdrop"
      data-state={presence.state}
      ref={presence.ref}
      onAnimationEnd={presence.onAnimationEnd}
      className="fixed inset-0 z-50 flex justify-end bg-ink/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalPanelRef}
        role="dialog"
        data-weight="sheet"
        data-state={presence.state}
        inert={!open}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={shown.current.description ? descriptionId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleModalKeyDown(event, onClose)}
        className={cn(
          "flex h-full w-full flex-col border-l border-line bg-surface shadow-lg outline-none motion-safe:animate-sheet-in",
          WIDTH_CLASS[width],
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="grid min-w-0 gap-1">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {shown.current.title}
            </h2>
            {shown.current.description ? (
              <p id={descriptionId} className="text-sm text-muted">
                {shown.current.description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            data-weight="press"
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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{shown.current.children}</div>
      </div>
    </div>
  );
};
