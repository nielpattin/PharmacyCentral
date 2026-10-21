import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // Migrating an in-process PostgreSQL takes a few seconds, and far more when Nx runs every project at once.
    hookTimeout: 60_000,
  },
});
