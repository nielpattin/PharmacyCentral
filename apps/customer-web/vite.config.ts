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

// The dev server and `vite preview` need the port; `vite build` (CI and the container image) does not.
// A busy port stops the server instead of moving to another one, because URLs such as PUBLIC_APP_URL assume it.
const servePort = (): number => {
  const value = process.env.CUSTOMER_WEB_PORT ?? rootEnv.CUSTOMER_WEB_PORT;
  if (!value) {
    throw new Error("Missing required environment variable: CUSTOMER_WEB_PORT. Please set it in your .env file.");
  }
  return Number.parseInt(value, 10);
};

export default defineConfig(({ command }) => {
  const server = command === "serve" ? { port: servePort(), strictPort: true } : {};
  return {
    plugins: [react(), tailwindcss()],
    /**
     * Vite exposes only what it loads from `envDir`, and that directory defaults to the app folder. The repository
     * keeps one `.env` at its root, so pointing at it is what lets `import.meta.env.VITE_*` in this app see the
     * same file every service reads. Vite still exposes only the `VITE_` prefixed names to the bundle.
     */
    envDir: "../..",
    server: { ...server, ...(apiProxy ? { proxy: apiProxy } : {}) },
    preview: { ...server, ...(apiProxy ? { proxy: apiProxy } : {}) },
  };
});
