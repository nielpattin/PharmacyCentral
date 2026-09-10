import pino, { type Logger, type LoggerOptions } from "pino";

export const createLogger = (options: LoggerOptions = {}): Logger =>
  pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie", "password", "token", "secret"],
    ...options,
  });

export type { Logger } from "pino";
