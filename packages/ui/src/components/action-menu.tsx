import { useId, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "../cn.ts";
import { nextMenuIndex } from "../menu-nav.ts";
import { usePresence } from "../presence.ts";
import { Button } from "./button.tsx";

export type ActionMenuItem = {
  id: string;
  /** Pass translated text. */
  label: string;
  onSelect: () => void;
  /** `danger` marks a destructive choice. */
  tone?: "default" | "danger";
  disabled?: boolean;
};

export type ActionMenuProps = {
  /** Names the menu button and the menu for screen readers, for example "More actions". Pass translated text. */
  label: string;
  items: readonly ActionMenuItem[];
  className?: string | undefined;
};

const MENU_CLASS =
  "fixed z-40 grid min-w-44 max-w-[calc(100vw-1rem)] gap-0.5 rounded-md border border-line bg-surface p-1 shadow-lg outline-none";

const ITEM_CLASS =
  "flex h-8 w-full items-center rounded px-2.5 text-left text-sm outline-none focus-visible:bg-surface-soft disabled:pointer-events-none disabled:opacity-50";

const ITEM_TONE = {
  default: "text-ink hover:bg-surface-soft",
  danger: "text-danger-ink hover:bg-danger-soft focus-visible:bg-danger-soft",
} as const;

const GAP = 4;
const EDGE = 8;

/**
 * Overflow menu for the less common actions of a table row or card, behind one "more" button. It is drawn in a layer
 * above the page, so a scrolling table never clips it, and it opens upward when there is no room below. Follows the
 * WAI-ARIA menu button pattern: Arrow keys, Home and End move between items (disabled ones are skipped), Escape closes
 * and returns focus to the button, and Tab, scrolling, resizing or a click outside close it.
 */
export const ActionMenu = ({ label, items, className }: ActionMenuProps): React.JSX.Element => {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const menuId = useId();
  const presence = usePresence(anchor !== null);
  const close = (): void => setAnchor(null);

  return (
    <>
      <Button
        ref={setTrigger}
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-controls={anchor === null ? undefined : menuId}
        onClick={(event) => setAnchor(anchor === null ? event.currentTarget.getBoundingClientRect() : null)}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </Button>
      {!presence.mounted
        ? null
        : createPortal(
            <div
              id={menuId}
              role="menu"
              data-weight="panel"
              data-state={presence.state}
              inert={anchor === null}
              onAnimationEnd={presence.onAnimationEnd}
              aria-label={label}
              tabIndex={-1}
              className={MENU_CLASS}
              ref={(element) => {
                presence.ref(element);
                if (element === null || anchor === null) return;
                // Place under the button, right edges aligned; flip above it when the window ends first.
                const { width, height } = element.getBoundingClientRect();
                const left = Math.max(EDGE, Math.min(anchor.right - width, window.innerWidth - width - EDGE));
                const below = anchor.bottom + GAP;
                element.style.left = `${left}px`;
                element.style.top = `${below + height > window.innerHeight - EDGE ? Math.max(EDGE, anchor.top - height - GAP) : below}px`;
                element.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();

                const dismiss = (): void => setAnchor(null);
                const dismissOutside = (event: PointerEvent): void => {
                  const target = event.target;
                  if (target instanceof Node && !element.contains(target) && !trigger?.contains(target)) dismiss();
                };
                document.addEventListener("pointerdown", dismissOutside, true);
                window.addEventListener("scroll", dismiss, true);
                window.addEventListener("resize", dismiss);
                return () => {
                  document.removeEventListener("pointerdown", dismissOutside, true);
                  window.removeEventListener("scroll", dismiss, true);
                  window.removeEventListener("resize", dismiss);
                };
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  close();
                  trigger?.focus();
                  return;
                }
                if (event.key === "Tab") {
                  close();
                  return;
                }
                const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
                const next = nextMenuIndex(
                  buttons.indexOf(document.activeElement as HTMLButtonElement),
                  event.key,
                  buttons.map((button) => !button.disabled),
                );
                if (next === undefined) return;
                event.preventDefault();
                buttons[next]?.focus();
              }}
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  data-weight="item"
                  disabled={item.disabled}
                  className={cn(ITEM_CLASS, ITEM_TONE[item.tone ?? "default"])}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )}
    </>
  );
};
