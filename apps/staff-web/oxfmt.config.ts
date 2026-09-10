import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: ["dist/**", "coverage/**", "node_modules/**"],
  printWidth: 120,
  tabWidth: 2,
});
