import { defineConfig } from "oxfmt";

export default defineConfig({
   ignorePatterns: ["dist", ".vite", "node_modules"],
   printWidth: 120,
   tabWidth: 3,
   overrides: [
      {
         files: ["*.md", "*.html"],
         options: {
            tabWidth: 4,
         },
      },
   ],
});
