import { Fragment } from "react";

import { Dialog } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";
import { formatShortcut, hotkeys } from "../lib/hotkeys.ts";

/**
 * Lists the shortcuts enabled on the current screen. Opened with "?".
 */
export const ShortcutsDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null => {
  if (!open) return null;
  const listing = hotkeys.list();
  return (
    <Dialog open onClose={onClose} title={translateText("Keyboard shortcuts")} className="max-w-md">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-sm">
        {listing.map((item) => (
          <Fragment key={`${item.combo}-${item.label}`}>
            <dt>
              <kbd className="rounded border border-line bg-surface-soft px-1.5 py-0.5 font-mono text-xs text-ink">
                {formatShortcut(item.combo)}
              </kbd>
            </dt>
            <dd className="text-ink">{translateText(item.label)}</dd>
          </Fragment>
        ))}
      </dl>
    </Dialog>
  );
};
