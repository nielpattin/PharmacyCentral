import { useId } from "react";

import { cn } from "../cn.ts";
import { handleModalKeyDown, modalPanelRef } from "../modal.ts";

/**
 * Centred modal. Escape and the backdrop close it, Tab stays inside it, body scroll is locked while it is open,
 * and focus returns to the element that was focused before it opened (same behaviour as Sheet).
 */
export const Dialog = ({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element | null => {
  const titleId = useId();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalPanelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleModalKeyDown(event, onClose)}
        className={cn(
          "flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface p-5 shadow-lg outline-none",
          className,
        )}
      >
        <h3 id={titleId} className="mb-3 shrink-0 text-base font-semibold text-ink">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
};
