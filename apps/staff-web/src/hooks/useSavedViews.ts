import { useState } from "react";

import { useSession } from "../auth.ts";
import {
  addSavedView,
  parseSavedViews,
  removeSavedView,
  renameSavedView,
  savedViewsStorageKey,
  type SavedView,
} from "../lib/saved-views.ts";
import { browserStorage, readStoredJson, writeStoredJson } from "../lib/storage.ts";

/**
 * Saved list views for one page, stored per signed-in user. Reads are validated, and bad entries are dropped.
 * Usage: see components/saved-views-menu.tsx, which pairs this with useListUrlState.
 *
 *   const saved = useSavedViews("purchase-orders");
 *   saved.views;                                          // SavedView[]
 *   saved.save("Expiring this week", { status: "open" }); // SavedView | undefined
 *   saved.rename(view.id, "Weekly");                      // boolean
 *   saved.remove(view.id);
 */
export type SavedViewsControls = {
  views: SavedView[];
  save: (name: string, params: Record<string, string>) => SavedView | undefined;
  rename: (id: string, name: string) => boolean;
  remove: (id: string) => void;
};

const newViewId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const useSavedViews = (pageKey: string): SavedViewsControls => {
  const userId = useSession().userId;
  const [, setRevision] = useState(0);
  const storage = browserStorage();
  const storageKey = userId ? savedViewsStorageKey(userId, pageKey) : undefined;
  const views = storageKey ? parseSavedViews(readStoredJson(storage, storageKey)) : [];

  // Writes bump a revision so the component re-reads storage; the stored list stays the source of truth.
  const commit = (next: SavedView[]): void => {
    if (storageKey) writeStoredJson(storage, storageKey, next);
    setRevision((revision) => revision + 1);
  };

  return {
    views,
    save: (name, params) => {
      const view: SavedView = { id: newViewId(), name, params };
      const next = storageKey ? addSavedView(views, view) : undefined;
      if (!next) return undefined;
      commit(next);
      return view;
    },
    rename: (id, name) => {
      const next = renameSavedView(views, id, name);
      if (!next) return false;
      commit(next);
      return true;
    },
    remove: (id) => commit(removeSavedView(views, id)),
  };
};
