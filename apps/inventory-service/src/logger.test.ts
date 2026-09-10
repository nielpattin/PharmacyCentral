import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.ts";

describe("inventory-service logger", () => {
  it("creates a pino logger instance with expected default level", () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(logger.level).toBe(process.env.LOG_LEVEL ?? "info");
  });

  it("applies custom options such as name and level", () => {
    const logger = createLogger({ name: "inventory-service", level: "warn" });
    expect(logger.level).toBe("warn");
  });
});
