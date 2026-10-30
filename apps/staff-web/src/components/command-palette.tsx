import { useRef, useState } from "react";

import { Dialog, Input } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";
import { filterPaletteEntries, type PaletteEntry } from "../navigation/workspaces.ts";
import type { StaffPath } from "../router.ts";

/**
 * Ctrl/Cmd+K page search. It lists every page the signed-in role may open, including the contextual data imports,
 * so a page can stay out of the sidebar without becoming hard to reach.
 */
export const CommandPalette = ({
  open,
  onClose,
  entries,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  entries: readonly PaletteEntry[];
  onSelect: (path: StaffPath) => void;
}): React.JSX.Element => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const results = filterPaletteEntries(entries, query, translateText);
  const selected = results.length === 0 ? undefined : results[Math.min(activeIndex, results.length - 1)];

  const move = (delta: number): void => {
    if (results.length === 0) return;
    const current = Math.min(activeIndex, results.length - 1);
    const next = (current + delta + results.length) % results.length;
    setActiveIndex(next);
    requestAnimationFrame(() => {
      const section = results[next]?.section;
      if (section !== undefined) {
        resultsRef.current
          ?.querySelector<HTMLElement>(`#command-palette-${section}`)
          ?.scrollIntoView({ block: "nearest" });
      }
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title={translateText("Search pages")} className="max-w-xl">
      <Input
        autoFocus
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          } else if (event.key === "Enter" && selected !== undefined) {
            event.preventDefault();
            onSelect(selected.path);
          }
        }}
        placeholder={translateText("Search pages…")}
        aria-label={translateText("Search pages")}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="command-palette-results"
        aria-activedescendant={selected === undefined ? undefined : `command-palette-${selected.section}`}
      />
      <div
        ref={resultsRef}
        id="command-palette-results"
        role="listbox"
        aria-label={translateText("Pages")}
        className="mt-3 max-h-80 overflow-y-auto"
      >
        {results.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted">{translateText("No pages match.")}</p>
        ) : null}
        {results.map((entry) => {
          const active = entry.section === selected?.section;
          return (
            <div
              key={entry.section}
              id={`command-palette-${entry.section}`}
              role="option"
              aria-selected={active}
              onMouseEnter={() => setActiveIndex(results.indexOf(entry))}
              onClick={() => onSelect(entry.path)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-sm ${
                active ? "bg-surface-soft text-ink" : "text-ink"
              }`}
            >
              <span className="font-medium">{translateText(entry.label)}</span>
              <span className="text-xs text-muted">{translateText(entry.workspace)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        {translateText("Use arrow keys to select, Enter to open, and Esc to close.")}
      </p>
    </Dialog>
  );
};
