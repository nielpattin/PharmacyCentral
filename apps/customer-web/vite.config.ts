import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Vite only reads shell env here, so load the repository-root .env explicitly.
// A plain `pnpm dev` then proxies /api/... to the gateway with no extra setup.
const rootEnv = loadEnv(process.env.NODE_ENV ?? "development", "../..", "");
const apiBaseUrl = process.env.API_BASE_URL ?? rootEnv.API_BASE_URL;
const apiProxy = apiBaseUrl
  ? {
      "/api": { target: apiBaseUrl, changeOrigin: true },
    }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /**
   * Vite exposes only what it loads from `envDir`, and that directory defaults to the app folder. The repository
   * keeps one `.env` at its root, so pointing at it is what lets `import.meta.env.VITE_*` in this app see the
   * same file every service reads. Vite still exposes only the `VITE_` prefixed names to the bundle.
   */
  envDir: "../..",
  server: {
    port: 5173,
    ...(apiProxy ? { proxy: apiProxy } : {}),
  },
  preview: {
    port: 5173,
    ...(apiProxy ? { proxy: apiProxy } : {}),
  },
});
