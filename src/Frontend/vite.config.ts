import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget =
   process.env.services__api__https__0 ||
   process.env.services__api__http__0 ||
   process.env.API_HTTPS ||
   process.env.API_HTTP ||
   process.env.SERVER_HTTPS ||
   process.env.SERVER_HTTP;

export default defineConfig({
   plugins: [react()],
   server: {
      proxy: {
         "/api": {
            target: apiProxyTarget,
            changeOrigin: true,
         },
      },
   },
});
