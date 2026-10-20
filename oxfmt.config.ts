import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    "**/dist/**",
    "**/coverage/**",
    "**/node_modules/**",
    "**/.nx/**",
    "**/drizzle/meta/**",
    "**/drizzle/migrations/meta",
    "tests",
    ".github",
    ".vscode",
    "README.md",
    "PLAN.md",
    ".pi/",
    "docs/**",
    "data/**",
  ],
  printWidth: 120,
  tabWidth: 2,
});
