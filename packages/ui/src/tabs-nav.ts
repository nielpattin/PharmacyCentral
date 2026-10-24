/**
 * Index of the tab to focus after a key press, or `undefined` when the key does not move focus. Arrow keys wrap around
 * the ends, as in the WAI-ARIA tabs pattern.
 */
export const nextTabIndex = (current: number, key: string, count: number): number | undefined => {
  if (count === 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  return undefined;
};
