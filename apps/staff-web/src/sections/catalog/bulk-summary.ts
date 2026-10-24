/**
 * Outcome of a bulk price action, one entry per row the action was tried on. `failures` keeps the order of the rows.
 */
export type BulkOutcome = { id: string; label: string; ok: boolean; message?: string | undefined };

export type BulkFailure = { id: string; label: string; message: string };

export type BulkSummary = { succeeded: number; total: number; failures: BulkFailure[] };

export const summarizeBulk = (outcomes: readonly BulkOutcome[]): BulkSummary => {
  const failures = outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => ({ id: outcome.id, label: outcome.label, message: outcome.message ?? "" }));
  return { succeeded: outcomes.length - failures.length, total: outcomes.length, failures };
};

/** "SKU - Name: reason; SKU2 - Name2: reason2". A failure without a reason shows its label alone. */
export const formatFailures = (failures: readonly BulkFailure[]): string =>
  failures.map((failure) => (failure.message ? `${failure.label}: ${failure.message}` : failure.label)).join("; ");
