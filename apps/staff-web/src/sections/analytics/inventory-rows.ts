/**
 * Pure row rules for the Inventory tab's charts. A figure the server did not answer is never drawn as zero: it keeps its
 * place at the end of the list and its bar stays empty, while the text shows "—". No React imports, so node can test them.
 */
import type { Figure } from "./contract.ts";
import { isAnswered } from "./figures.ts";

/** The rows by value, largest first. Rows with an unanswered value go last, in their input order. */
export const rankByValue = <T extends { value: Figure }>(rows: readonly T[]): T[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = isAnswered(a.row.value);
      const right = isAnswered(b.row.value);
      if (left && right) return (b.row.value as number) - (a.row.value as number) || a.index - b.index;
      if (left !== right) return left ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);

/** The size a bar or segment is drawn from: the answered value, or 0 so an unanswered figure draws nothing. */
export const drawnSize = (value: Figure | undefined): number => (isAnswered(value) && value > 0 ? value : 0);
