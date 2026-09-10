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
  server: {
    port: 5173,
    ...(apiProxy ? { proxy: apiProxy } : {}),
  },
  preview: {
    port: 5173,
    ...(apiProxy ? { proxy: apiProxy } : {}),
  },
});
