export type BulkOutcome = { label: string; ok: true } | { label: string; ok: false; message: string };

export type BulkSummary = {
  done: number;
  total: number;
  failed: Array<{ label: string; message: string }>;
};

/** Counts the outcomes of a bulk write, one per record, in the order they ran. */
export const summarizeBulk = (outcomes: readonly BulkOutcome[]): BulkSummary => {
  const failed = outcomes.flatMap((outcome) =>
    outcome.ok ? [] : [{ label: outcome.label, message: outcome.message }],
  );
  return { done: outcomes.length - failed.length, total: outcomes.length, failed };
};

/** Fills `{name}` tokens of a translated sentence. A token without a value stays as written. */
export const fillText = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : match));
