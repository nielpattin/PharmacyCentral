import type { ReactNode } from "react";

import { cn } from "../cn.ts";
import { placeThumb } from "../segment-thumb.ts";
import { SEGMENT_THUMB, SEGMENT_TRACK, segmentClass } from "../segmented.ts";
import { nextTabIndex } from "../tabs-nav.ts";

export type TabItem = { id: string; label: ReactNode };

export type TabsProps = {
  items: readonly TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  /** Names the tab group for screen readers. Pass translated text. */
  "aria-label": string;
  /** When set, each tab gets `aria-controls` pointing at `tabPanelId(idBase, id)`; render a matching panel. */
  idBase?: string | undefined;
  className?: string | undefined;
};

export const tabId = (idBase: string, id: string): string => `${idBase}-${id}-tab`;
export const tabPanelId = (idBase: string, id: string): string => `${idBase}-${id}-panel`;

/**
 * Tab group for switching between views of one page, in the same segmented look as `ToggleGroup`, following the WAI-ARIA tabs pattern: one tab stop
 * (roving tabindex), Arrow, Home and End move focus, and Enter or Space opens the focused tab. It never wraps onto a
 * second line; on a narrow screen the row scrolls sideways.
 */
export const Tabs = ({ items, value, onValueChange, idBase, className, ...props }: TabsProps): React.JSX.Element => {
  const tabStop = items.some((item) => item.id === value) ? value : items[0]?.id;
  return (
    <div
      role="tablist"
      aria-label={props["aria-label"]}
      ref={(element) => placeThumb(element)}
      className={cn(SEGMENT_TRACK, "overflow-x-auto [scrollbar-width:none]", className)}
      onKeyDown={(event) => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        const next = nextTabIndex(
          buttons.indexOf(document.activeElement as HTMLButtonElement),
          event.key,
          buttons.length,
        );
        if (next === undefined) return;
        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      <span aria-hidden="true" data-weight="thumb" className={SEGMENT_THUMB} />
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            data-weight="press"
            role="tab"
            id={idBase === undefined ? undefined : tabId(idBase, item.id)}
            aria-selected={selected}
            aria-controls={idBase === undefined ? undefined : tabPanelId(idBase, item.id)}
            tabIndex={item.id === tabStop ? 0 : -1}
            onClick={() => onValueChange(item.id)}
            className={segmentClass(selected)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
};
