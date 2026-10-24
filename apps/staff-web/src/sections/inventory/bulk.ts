/**
 * Pure helpers for bulk writes. A bulk action sends one request per item and reports one summary, so a partial failure
 * shows which items did not change and why. Templates are translated by the caller before they reach `bulkMessage`.
 */

export type BulkOutcome = { label: string; error: string | undefined };

export type BulkSummary = {
  total: number;
  done: number;
  failures: Array<{ label: string; error: string }>;
};

export type BulkMessage = { tone: "success" | "error"; text: string };

export type BulkTemplates = {
  /** Used when every item succeeded. Placeholders: {done}, {total}. */
  success: string;
  /** Used when at least one item failed. Placeholders: {done}, {total}. */
  partial: string;
  /** Introduces the list of failed items, for example "Not completed:". */
  failedPrefix: string;
};

export const fillTemplate = (template: string, values: Readonly<Record<string, number | string>>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

export const summarizeBulk = (outcomes: readonly BulkOutcome[]): BulkSummary => {
  const failures = outcomes.flatMap((outcome) =>
    outcome.error === undefined ? [] : [{ label: outcome.label, error: outcome.error }],
  );
  return { total: outcomes.length, done: outcomes.length - failures.length, failures };
};

export const bulkMessage = (summary: BulkSummary, templates: BulkTemplates): BulkMessage => {
  const counts = { done: summary.done, total: summary.total };
  if (summary.failures.length === 0) return { tone: "success", text: fillTemplate(templates.success, counts) };
  const details = summary.failures.map((failure) => `${failure.label}: ${failure.error}`).join("; ");
  return {
    tone: "error",
    text: `${fillTemplate(templates.partial, counts)} ${templates.failedPrefix} ${details}`,
  };
};

/** Sends one request per item, in order, and records each outcome. A failure does not stop the rest. */
export const runEach = async <T>(
  items: readonly T[],
  describe: (item: T) => string,
  send: (item: T) => Promise<unknown>,
): Promise<BulkOutcome[]> => {
  const outcomes: BulkOutcome[] = [];
  for (const item of items) {
    try {
      await send(item);
      outcomes.push({ label: describe(item), error: undefined });
    } catch (reason) {
      outcomes.push({
        label: describe(item),
        error: reason instanceof Error ? reason.message : "The request failed.",
      });
    }
  }
  return outcomes;
};
