import { useId, useState, type ReactNode } from "react";

import { cn } from "../cn.ts";
import { Button, type ButtonProps } from "./button.tsx";

export type PopoverProps = {
  /** Text of the button that opens the panel. Pass translated text. */
  buttonLabel: ReactNode;
  /** Names the panel for screen readers. Pass translated text. */
  panelLabel: string;
  /** The panel content, or a function that gets `close` for items that dismiss the panel when chosen. */
  children: ReactNode | ((close: () => void) => ReactNode);
  buttonVariant?: ButtonProps["variant"];
  /** Width and other classes of the panel. It never grows past the window. */
  panelClassName?: string | undefined;
};

// Above the sticky table header (z-20) and below dialogs and sheets.
const PANEL_CLASS =
  "absolute right-0 z-40 mt-1 max-w-[calc(100vw-1rem)] rounded-md border border-line bg-surface shadow-lg outline-none";

/**
 * A button that opens a floating panel under it. At most one stays open: the panel closes when focus or a click moves
 * anywhere outside it, and on Escape, which returns focus to the button. If the panel would run past the left edge of
 * the window it aligns to the button's left edge instead.
 */
export const Popover = ({
  buttonLabel,
  panelLabel,
  children,
  buttonVariant = "secondary",
  panelClassName,
}: PopoverProps): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const close = (): void => setOpen(false);
  return (
    <div
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
      }}
    >
      <Button
        type="button"
        variant={buttonVariant}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {buttonLabel}
      </Button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label={panelLabel}
          // tabIndex makes a click on non-interactive panel text keep focus inside, so it does not count as leaving.
          tabIndex={-1}
          ref={(element) => {
            if (element !== null && element.getBoundingClientRect().left < 8) {
              element.style.right = "auto";
              element.style.left = "0";
            }
          }}
          className={cn(PANEL_CLASS, panelClassName)}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
};
