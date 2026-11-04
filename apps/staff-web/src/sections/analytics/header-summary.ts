export type HeaderSummaryInput = {
  /** "Current period" and its dates, already translated, or empty when the range is not valid. */
  current: string;
  /** "Previous period" and its dates, or empty while no answer has arrived. */
  previous: string;
  /** "Updated at" and the time, or empty while no answer has arrived. */
  updated: string;
};

const SEPARATOR = " · ";

/** The covered range, the one before it and the update time as one line; a part that is empty is left out. */
export const headerSummary = ({ current, previous, updated }: HeaderSummaryInput): string =>
  [current, previous, updated].filter((part) => part !== "").join(SEPARATOR);
