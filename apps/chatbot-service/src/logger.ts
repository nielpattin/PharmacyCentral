import { createRequire } from "node:module";
import type pino from "pino";
import type { Logger } from "pino";

export type { Logger };

// pino is loaded with require, not `import`: telemetry.ts patches pino with PinoInstrumentation, and that patch
// only intercepts CommonJS require(). An ESM import would get the unpatched module (no trace_id, no OTel log export).
const pinoFactory = createRequire(import.meta.url)("pino") as typeof pino;

/** Writes JSON logs to stdout. Callers must not log question or reply text. */
export const createLogger = (): Logger =>
  pinoFactory({
    level: "info",
    redact: ["req.headers.authorization", "req.headers.cookie", "password", "token", "secret", "apiKey"],
  });
