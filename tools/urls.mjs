// Named local URLs for the web apps and the gateway, through portless (https://github.com/vercel-labs/portless).
//
//   customer.pharmacy.localhost -> customer-web  (CUSTOMER_WEB_PORT)
//   staff.pharmacy.localhost    -> staff-web     (STAFF_WEB_PORT)
//   api.pharmacy.localhost      -> gateway       (GATEWAY_PORT)
//
// Each name is its own browser origin, so the customer and staff tokens in `localStorage` never meet. The routes are aliases to the fixed ports,
// so they work the same for `pnpm dev` and for the container stack. The proxy listens on plain HTTP, port 80:
// `*.localhost` is a secure context in browsers, and no certificate has to be trusted.
//
// Usage: node --env-file=.env tools/urls.mjs up | down | list
import { spawnSync } from "node:child_process";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  return value;
};

const routes = [
  ["customer.pharmacy", required("CUSTOMER_WEB_PORT")],
  ["staff.pharmacy", required("STAFF_WEB_PORT")],
  ["api.pharmacy", required("GATEWAY_PORT")],
];

const portless = (...args) => {
  // One command string: the arguments are fixed names and ports, and Windows needs the shell to run `pnpm`.
  const result = spawnSync(`pnpm exec portless ${args.join(" ")}`, { stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const command = process.argv[2];
if (command === "up") {
  portless("proxy", "start", "--no-tls");
  for (const [name, port] of routes) portless("alias", name, port, "--force");
  portless("list");
} else if (command === "down") {
  for (const [name] of routes) portless("alias", "--remove", name);
  portless("proxy", "stop");
} else if (command === "list") {
  portless("list");
} else {
  console.error("Usage: node --env-file=.env tools/urls.mjs up | down | list");
  process.exit(1);
}
