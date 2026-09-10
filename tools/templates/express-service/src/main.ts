import { createServer } from "node:http";

import { createApp } from "./app.ts";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const server = createServer(createApp());

const shutdown = (signal: string): void => {
  server.close((error) => {
    if (error) {
      console.error({ error, signal }, "service shutdown failed");
      process.exitCode = 1;
      return;
    }

    process.exitCode = 0;
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

server.listen(port, "0.0.0.0", () => {
  console.log({ port }, "service listening");
});
