import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget =
   process.env.services__api__https__0 ||
   process.env.services__api__http__0 ||
   process.env.API_HTTPS ||
   process.env.API_HTTP ||
   process.env.SERVER_HTTPS ||
   process.env.SERVER_HTTP;

export default defineConfig({
   plugins: [react(), tailwindcss()],
   resolve: {
      alias: {
         "@": path.resolve(__dirname, "./src"),
      },
   },
   server: {
      proxy: {
         "/api": {
            target: apiProxyTarget,
            changeOrigin: true,
         },
      },
   },
});
