/**
 * Pure row rules for the Targets tab's progress rows. A site without a target has no progress: it sits after the sites
 * that have one and reads "—", never 0%. No React imports, so node can test them.
 */
import type { SalesTargetSiteRow } from "./contract.ts";
import { isAnswered } from "./figures.ts";

/** Sites with a target first, by progress from highest to lowest; sites without one after, in their input order. */
export const rankByProgress = (rows: readonly SalesTargetSiteRow[]): SalesTargetSiteRow[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = isAnswered(a.row.progress);
      const right = isAnswered(b.row.progress);
      if (left && right) return (b.row.progress as number) - (a.row.progress as number) || a.index - b.index;
      if (left !== right) return left ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);

/** The size a progress bar is drawn from: the answered progress, or 0 for a site without a target. */
export const progressSize = (progress: SalesTargetSiteRow["progress"]): number =>
  isAnswered(progress) && progress > 0 ? progress : 0;
