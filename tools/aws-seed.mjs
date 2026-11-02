// Loads the demo dataset into the AWS demo stack: sites, accounts, catalog with images, stock, search synonyms, demo
// activity and 60 days of backdated sales history. It is tools/seed-demo.mjs pointed at the deployed stack:
//   - the API calls go to https://staff.<domain>/api, the same path the browser uses;
//   - the product images go to the real media bucket (tools/aws-upload-media.mjs);
//   - accounts are created and the history is backdated by the one-shot `ops` ECS task, because RDS is private.
// Usage: node tools/aws-seed.mjs        (the stack must be up: pnpm run cloud:deploy)
// Safe to run again: every step is idempotent, and a history that exists is left as it is.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (!existsSync(envFile)) throw new Error(`Missing ${envFile}. Create it from .env.example first.`);

const dotEnv = {};
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (match) dotEnv[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
}

const awsEnv = {
  ...process.env,
  AWS_PROFILE: "pharmacy",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_ENDPOINT_URL_S3: "",
  AWS_ENDPOINT_URL: "",
};
const web = JSON.parse(
  execFileSync("terraform", ["-chdir=deploy/aws", "output", "-json", "web"], {
    cwd: root,
    encoding: "utf8",
    env: awsEnv,
  }),
);

// .env supplies the passwords and the SePay secret (the same values the stack was deployed with by tools/aws-env.mjs).
// Anything already in the environment wins, and AWS_* stay the real ones set above.
const env = {
  ...dotEnv,
  ...awsEnv,
  DEMO_SEED_TARGET: "cloud",
  API_BASE_URL: web.staff_url,
  NODE_ENV: "development",
};
for (const name of ["ADMIN_PASSWORD", "DEMO_ACCOUNT_PASSWORD", "SEPAY_WEBHOOK_SECRET"]) {
  if (!env[name]) throw new Error(`${name} must be set in .env: the deployed stack uses the same value.`);
}

console.log(`Seeding ${web.staff_url} ...`);
const result = spawnSync(process.execPath, ["--experimental-transform-types", "tools/seed-demo.mjs"], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
