/**
 * Index of the menu item to focus after a key press, or `undefined` when the key does not move focus. Arrow keys wrap
 * around the ends, as in the WAI-ARIA menu pattern. Disabled items are skipped.
 */
export const nextMenuIndex = (current: number, key: string, enabled: readonly boolean[]): number | undefined => {
  const count = enabled.length;
  const step = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  if (step === 0 && key !== "Home" && key !== "End") return undefined;
  if (!enabled.includes(true)) return undefined;
  if (key === "Home") return enabled.indexOf(true);
  if (key === "End") return enabled.lastIndexOf(true);
  // Nothing focused yet: Up starts from the last item, Down from the first.
  let index = current < 0 && step < 0 ? 0 : current;
  for (let tried = 0; tried < count; tried += 1) {
    index = (index + step + count) % count;
    if (enabled[index]) return index;
  }
  return undefined;
};
