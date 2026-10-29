import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // Migrating an in-process PostgreSQL takes a few seconds, and far more when Nx runs every project at once.
    hookTimeout: 60_000,
    // Every test file starts its own in-process PostgreSQL. Without a cap, a full `nx run-many` on a 16-thread machine
    // runs 40 of them at once and workers die from memory exhaustion or failed process spawns.
    maxWorkers: 4,
  },
});
