import { useRef } from "react";

import { useOpenKey } from "./useOpenKey.ts";

export type RetainedTarget<T> = { target: T; key: number };

/**
 * Keeps the last target a drawer was opened with, so the drawer can stay mounted while it closes and still hold its
 * content. Use it to mount a drawer that opens for one row:
 *
 *   const planDrawer = useRetainedTarget(planDraft);
 *   {planDrawer ? (
 *     <CreatePlanDrawer key={planDrawer.key} draft={planDrawer.target} open={planDraft !== undefined} onClose={…} />
 *   ) : null}
 *
 * The `key` changes on every opening, so the drawer starts clean each time even though it outlived the last close.
 * While the drawer is open, a new target replaces the shown one without remounting it.
 */
export const useRetainedTarget = <T>(value: T | undefined): RetainedTarget<T> | undefined => {
  const kept = useRef<RetainedTarget<T> | undefined>(undefined);
  const key = useOpenKey(value !== undefined);
  if (value !== undefined) kept.current = { target: value, key };
  return kept.current;
};
