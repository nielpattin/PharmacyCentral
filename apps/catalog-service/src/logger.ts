import { createRequire } from "node:module";
import type pino from "pino";
import type { Logger, LoggerOptions } from "pino";

// pino is loaded with require, not `import`: telemetry.ts patches pino with PinoInstrumentation, and that patch
// only intercepts CommonJS require(). An ESM import would get the unpatched module (no trace_id, no OTel log export).
const pinoFactory = createRequire(import.meta.url)("pino") as typeof pino;

/**
 * pino serialises only the `err` key, so `logger.warn({ error }, ...)` printed `"error":{}`. This keeps the cause
 * visible under `error` too. It leaves out own properties on purpose: database errors carry the offending values.
 */
const serializeError = (value: unknown): unknown => {
  if (!(value instanceof Error)) return value;
  const code = "code" in value && typeof value.code === "string" ? value.code : undefined;
  return { type: value.name, message: value.message, ...(code === undefined ? {} : { code }), stack: value.stack };
};

export const createLogger = (options: LoggerOptions = {}): Logger =>
  pinoFactory({
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie", "password", "token", "secret"],
    serializers: { error: serializeError },
    ...options,
  });

export type { Logger } from "pino";
