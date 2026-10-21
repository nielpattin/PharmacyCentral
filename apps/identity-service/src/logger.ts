import { createRequire } from "node:module";
import type pino from "pino";
import type { Logger, LoggerOptions } from "pino";

// pino is loaded with require, not `import`: telemetry.ts patches pino with PinoInstrumentation, and that patch
// only intercepts CommonJS require(). An ESM import would get the unpatched module (no trace_id, no OTel log export).
const pinoFactory = createRequire(import.meta.url)("pino") as typeof pino;

export const createLogger = (options: LoggerOptions = {}): Logger =>
  pinoFactory({
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie", "password", "token", "secret"],
    ...options,
  });

export type { Logger } from "pino";
