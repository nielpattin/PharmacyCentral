import { createRequire } from "node:module";
import type pino from "pino";
import type { Logger } from "pino";

export type { Logger };

// pino is loaded with require, not `import`: telemetry.ts patches pino with PinoInstrumentation, and that patch
// only intercepts CommonJS require(). An ESM import would get the unpatched module (no trace_id, no OTel log export).
const pinoFactory = createRequire(import.meta.url)("pino") as typeof pino;

/**
 * pino serialises only the `err` key, so other keys holding an Error need this serializer. It leaves out own
 * properties on purpose: database errors carry the offending values.
 */
const serializeError = (value: unknown): unknown => {
  if (!(value instanceof Error)) return value;
  const code = "code" in value && typeof value.code === "string" ? value.code : undefined;
  return { type: value.name, message: value.message, ...(code === undefined ? {} : { code }), stack: value.stack };
};

/** Callers must not log question or reply text. */
export const createLogger = (): Logger =>
  pinoFactory({
    level: "info",
    serializers: { error: serializeError },
    redact: ["req.headers.authorization", "req.headers.cookie", "password", "token", "secret", "apiKey"],
  });
