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
    "tools/jira-sheet-sync",
    ".github",
    ".vscode",
    "README.md",
    "PLAN.md",
    ".pi/",
    "docs/**",
  ],
  printWidth: 120,
  tabWidth: 2,
});
