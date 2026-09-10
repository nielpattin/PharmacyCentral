import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: ["dist/**", "coverage/**", "node_modules/**", "drizzle/meta/**", "drizzle/migrations/meta/**"],
  printWidth: 120,
  tabWidth: 2,
});
