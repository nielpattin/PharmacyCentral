import pino, { type Logger } from "pino";

export type { Logger };

/** Writes JSON logs to stdout. Callers must not log question or reply text. */
export const createLogger = (): Logger =>
  pino({
    level: "info",
    redact: ["req.headers.authorization", "req.headers.cookie", "password", "token", "secret", "apiKey"],
  });
