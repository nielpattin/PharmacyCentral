import { useId, useRef } from "react";

import { cn } from "../cn.ts";
import { handleModalKeyDown, modalPanelRef } from "../modal.ts";
import { usePresence } from "../presence.ts";

/**
 * Centred modal. Escape and the backdrop close it, Tab stays inside it, body scroll is locked while it is open,
 * and focus returns to the element that was focused before it opened (same behaviour as Sheet). On close it plays its
 * exit animation, showing what it last showed, before it unmounts.
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
  const presence = usePresence(open);
  // While the exit animation plays the parent has usually cleared what the dialog showed; keep the last content.
  const shown = useRef({ title, children, className });
  if (open) shown.current = { title, children, className };
  if (!presence.mounted) return null;
  return (
    <div
      data-weight="backdrop"
      data-state={presence.state}
      // The backdrop leaves in step with the panel, so its exit decides when the whole dialog unmounts.
      ref={presence.ref}
      onAnimationEnd={presence.onAnimationEnd}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        data-weight="dialog"
        data-state={presence.state}
        inert={!open}
        ref={modalPanelRef}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleModalKeyDown(event, onClose)}
        className={cn(
          "flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface p-5 shadow-lg outline-none",
          shown.current.className,
        )}
      >
        <h3 id={titleId} className="mb-3 shrink-0 text-base font-semibold text-ink">
          {shown.current.title}
        </h3>
        {shown.current.children}
      </div>
    </div>
  );
};
