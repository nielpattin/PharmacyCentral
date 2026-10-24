import { useState } from "react";

import { Button, useToast } from "@pharmacy/ui";

import { useListUrlState } from "../hooks/useListUrlState.ts";
import { useSavedViews } from "../hooks/useSavedViews.ts";
import { translateText } from "../i18n.ts";
import { serializeListValues, type ListDefaults } from "../lib/list-url-state.ts";
import { MAX_SAVED_VIEWS, type SavedView } from "../lib/saved-views.ts";
import { useConfirm, usePrompt } from "./confirm.tsx";

/**
 * Saved filter sets for one list screen, shown in the list toolbar. Applying a view writes its params to the URL, so
 * Back and refresh keep it. Pass the same `defaults` the page passes to `useListUrlState`.
 *
 * Usage:
 *   const LIST_DEFAULTS = { q: "", status: "all" } as const;
 *   <SavedViewsMenu pageKey="purchase-orders" defaults={LIST_DEFAULTS} />
 */
export const SavedViewsMenu = ({
  pageKey,
  defaults,
}: {
  pageKey: string;
  defaults: ListDefaults;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const list = useListUrlState(defaults);
  const saved = useSavedViews(pageKey);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();
  const currentParams = serializeListValues(list.values, defaults);

  const apply = (view: SavedView): void => {
    const patch: Record<string, string> = {};
    for (const key of Object.keys(defaults)) patch[key] = view.params[key] ?? defaults[key] ?? "";
    list.setValues(patch);
    setOpen(false);
  };

  const save = async (): Promise<void> => {
    const name = await prompt({ title: "Save view", label: "View name", required: true, confirmLabel: "Save" });
    if (name === null) return;
    if (saved.save(name, currentParams)) {
      toast.success(translateText("View saved."));
      return;
    }
    toast.error(
      translateText(
        saved.views.length >= MAX_SAVED_VIEWS ? "Saved view limit reached." : "View name must be 1 to 60 characters.",
      ),
    );
  };

  const rename = async (view: SavedView): Promise<void> => {
    const name = await prompt({
      title: "Rename view",
      label: "View name",
      required: true,
      defaultValue: view.name,
      confirmLabel: "Rename",
    });
    if (name === null) return;
    if (!saved.rename(view.id, name)) toast.error(translateText("View name must be 1 to 60 characters."));
  };

  const remove = async (view: SavedView): Promise<void> => {
    const accepted = await confirm({
      title: "Delete saved view?",
      description: view.name,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (accepted) saved.remove(view.id);
  };

  return (
    <div className="relative">
      <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {translateText("Saved views")}
      </Button>
      {open ? (
        <div
          role="region"
          aria-label={translateText("Saved views")}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className="absolute right-0 z-20 mt-2 grid w-72 gap-2 rounded-md border border-line bg-surface p-3 shadow-lg"
        >
          {saved.views.length === 0 ? (
            <p className="text-sm text-muted">{translateText("No saved views yet.")}</p>
          ) : (
            <ul className="grid gap-1">
              {saved.views.map((view) => (
                <li key={view.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => apply(view)}
                    className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-soft"
                  >
                    {view.name}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${translateText("Rename")}: ${view.name}`}
                    onClick={() => void rename(view)}
                  >
                    {translateText("Rename")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${translateText("Delete")}: ${view.name}`}
                    onClick={() => void remove(view)}
                  >
                    {translateText("Delete")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" size="sm" onClick={() => void save()}>
            {translateText("Save current view")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
