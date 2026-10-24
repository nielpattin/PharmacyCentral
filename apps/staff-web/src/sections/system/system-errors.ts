// Maps API problems (`{ title, status, code }`) to the message the page shows. Pure: messages are English keys that
// the page passes through translateText.
export type ProblemDetails = { status?: number; code?: string };

// ApiProblemError carries the parsed problem JSON on `problem`. Duck-typed so this module has no runtime imports.
const problemOf = (error: unknown): ProblemDetails | undefined => {
  if (!(error instanceof Error) || !("problem" in error)) return undefined;
  const problem: unknown = error.problem;
  return typeof problem === "object" && problem !== null ? (problem as ProblemDetails) : undefined;
};

const problemMessage =
  (messages: Record<string, string>, fallback: string) =>
  (error: unknown): string => {
    const code = problemOf(error)?.code;
    const message = code === undefined ? undefined : messages[code];
    return message ?? fallback;
  };

export const metricsErrorMessage = problemMessage(
  {
    prometheus_unavailable: "Metrics are unavailable because Prometheus did not answer.",
    invalid_request: "This service has no metrics.",
  },
  "Unable to load metrics.",
);
