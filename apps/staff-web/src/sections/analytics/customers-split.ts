/**
 * Pure rules for the bars on the Overview and Customers tabs. No React or API imports, so node can test them.
 */
import type { Figure } from "./contract.ts";
import { isAnswered } from "./figures.ts";

/** The number a bar segment is sized from. An unanswered, zero or negative figure draws no segment, never a fake one. */
export const partValue = (figure: Figure | undefined): number => (isAnswered(figure) && figure > 0 ? figure : 0);

/** The total of the parts of a split, for the centre of its ring. `null` when any part is unanswered. */
export const splitTotal = (parts: ReadonlyArray<Figure | undefined>): Figure =>
  parts.every(isAnswered) ? parts.reduce<number>((sum, part) => sum + part, 0) : null;

/**
 * Revenue of sales with no customer account (walk-in counter sales), worked back from the identified revenue and its
 * share of all revenue. `null` when either is unanswered or the share is 0, because the total cannot then be known.
 */
export const anonymousRevenue = (
  identifiedRevenue: Figure | undefined,
  identifiedShare: Figure | undefined,
): Figure => {
  if (!isAnswered(identifiedRevenue) || !isAnswered(identifiedShare) || identifiedShare <= 0) return null;
  return Math.max(0, Math.round(identifiedRevenue / identifiedShare - identifiedRevenue));
};
