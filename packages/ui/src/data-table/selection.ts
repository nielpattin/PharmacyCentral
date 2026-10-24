export type SelectionState = "none" | "some" | "all";

/** Header checkbox state for the rows on screen. */
export const selectionState = (visibleKeys: readonly string[], selected: ReadonlySet<string>): SelectionState => {
  if (!visibleKeys.some((key) => selected.has(key))) return "none";
  return visibleKeys.every((key) => selected.has(key)) ? "all" : "some";
};

export const toggleSelectionKey = (selected: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** Adds or removes every visible key, leaving selections outside the visible rows untouched. */
export const setVisibleSelection = (
  selected: ReadonlySet<string>,
  visibleKeys: readonly string[],
  checked: boolean,
): Set<string> => {
  const next = new Set(selected);
  for (const key of visibleKeys) {
    if (checked) next.add(key);
    else next.delete(key);
  }
  return next;
};
