import { z } from "zod";

/**
 * Saved list views: named sets of URL params, stored per user and page. Each stored entry is validated on read, and a
 * malformed entry is dropped without hiding the valid ones.
 *
 * Usage: see hooks/useSavedViews.ts and components/saved-views-menu.tsx.
 */
export const MAX_SAVED_VIEWS = 20;
export const SAVED_VIEW_NAME_MAX = 60;

export const savedViewSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX),
  params: z.record(z.string().min(1).max(64), z.string().max(200)),
});

export type SavedView = z.infer<typeof savedViewSchema>;

const savedViewNameSchema = z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX);

export const savedViewsStorageKey = (userId: string, pageKey: string): string =>
  `pharmacy-central:saved-views:${userId}:${pageKey}`;

export const parseSavedViews = (raw: unknown): SavedView[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const views: SavedView[] = [];
  for (const item of raw) {
    const parsed = savedViewSchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    views.push(parsed.data);
    if (views.length === MAX_SAVED_VIEWS) break;
  }
  return views;
};

/** Returns undefined when the limit is reached or the view is invalid. */
export const addSavedView = (views: readonly SavedView[], view: SavedView): SavedView[] | undefined => {
  if (views.length >= MAX_SAVED_VIEWS) return undefined;
  const parsed = savedViewSchema.safeParse(view);
  return parsed.success ? [...views, parsed.data] : undefined;
};

/** Returns undefined when the new name is empty or too long. */
export const renameSavedView = (views: readonly SavedView[], id: string, name: string): SavedView[] | undefined => {
  const parsed = savedViewNameSchema.safeParse(name);
  if (!parsed.success) return undefined;
  return views.map((view) => (view.id === id ? { ...view, name: parsed.data } : view));
};

export const removeSavedView = (views: readonly SavedView[], id: string): SavedView[] =>
  views.filter((view) => view.id !== id);
