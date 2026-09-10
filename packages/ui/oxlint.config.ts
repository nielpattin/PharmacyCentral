import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript"],
  options: {
    typeAware: true,
    typeCheck: false,
  },
  ignorePatterns: ["dist/**", "coverage/**", "node_modules/**"],
  rules: {
    "typescript/no-floating-promises": "error",
    "typescript/no-unsafe-assignment": "warn",
    "typescript/no-unsafe-call": "warn",
    "typescript/no-unsafe-member-access": "warn",
  },
});
