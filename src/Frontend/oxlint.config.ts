import { defineConfig } from "oxlint";

export default defineConfig({
   plugins: ["react"],
   options: {
      typeAware: true,
      typeCheck: true,
   },
   env: {
      browser: true,
   },
   ignorePatterns: ["dist"],
   rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": "warn",
      "react/prefer-function-component": "warn",
   },
});
