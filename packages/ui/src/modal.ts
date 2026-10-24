export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside a modal panel. */
const trapTab = (event: React.KeyboardEvent<HTMLElement>): void => {
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

/** Escape closes (and stops propagation so a parent modal stays open); Tab is trapped. */
export const handleModalKeyDown = (event: React.KeyboardEvent<HTMLElement>, onClose: () => void): void => {
  if (event.key === "Escape") {
    event.stopPropagation();
    onClose();
  } else if (event.key === "Tab") {
    trapTab(event);
  }
};

/**
 * Ref callback for a modal panel. It locks body scroll, focuses the panel, and on unmount restores the scroll
 * and returns focus to the element that was focused before the modal opened. A ref callback instead of an effect:
 * React runs the cleanup when the panel unmounts.
 */
export const modalPanelRef = (panel: HTMLDivElement | null): (() => void) | undefined => {
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
};
