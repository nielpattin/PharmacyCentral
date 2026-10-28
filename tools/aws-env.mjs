// Writes deploy/aws/demo.auto.tfvars.json (git-ignored: it holds secrets) from the root .env and the service
// environment that docker-compose.yml gives each backend. Usage: node tools/aws-env.mjs [imageTag]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(new URL("../deploy/aws/demo.auto.tfvars.json", import.meta.url));

const services = [
  "identity-service",
  "catalog-service",
  "inventory-service",
  "sales-service",
  "payment-service",
  "operations-query-service",
  "chatbot-service",
  "search-service",
  "ops-console-service",
];

// Keys that deploy/aws sets itself (service URLs, databases, brokers, telemetry, storage, the web origin), plus the
// embedder and Google sign-in, which the demo does not run. DATABASE_USER and DATABASE_PASSWORD are the admin
// credentials that compose passes but no service reads, so they must not reach the services.
const ownedKeys = new Set([
  "PORT",
  "NODE_ENV",
  "COOKIE_SECURE",
  "LOG_LEVEL",
  "DATABASE_URL",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
  "RABBITMQ_URL",
  "REDIS_URL",
  "TYPESENSE_URL",
  "TYPESENSE_API_KEY",
  "SECRETS_ENCRYPTION_KEY",
  "INTERNAL_IDENTITY_SECRET",
  "INTERNAL_SERVICE_SECRET",
  "INTERNAL_IDENTITY_AUDIENCE",
  "PROMETHEUS_URL",
  "GRAFANA_PUBLIC_URL",
  "PUBLIC_APP_URL",
  "DRIZZLE_MIGRATIONS_DIR",
  "MEDIA_BUCKET",
  "PUBLIC_MEDIA_URL",
]);
const ownedPrefixes = ["OTEL_", "RABBITMQ_MANAGEMENT_", "AWS_", "AI_EMBEDDING_", "GOOGLE_"];
const passesThrough = (key) =>
  !ownedKeys.has(key) && !ownedPrefixes.some((prefix) => key.startsWith(prefix)) && !key.endsWith("_SERVICE_URL");
const isSecret = (key) => /KEY|SECRET|PASSWORD|TOKEN/.test(key);

// Compose literals that name hosts which do not exist on AWS. EMAIL_PROVIDER=log sends nothing (it writes the mail to
// the log), so the demo has no verification or password reset, as the owner decided. The SMTP host is never dialled.
const overrides = {
  "identity-service": { EMAIL_PROVIDER: "log", SMTP_HOST: "smtp.invalid" },
};

const readDotEnv = () => {
  const file = fileURLToPath(new URL("../.env", import.meta.url));
  if (!existsSync(file)) throw new Error(`Missing ${file}. Create it from .env.example first.`);
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
};

// `docker compose config` merges the YAML anchors and interpolates ${VAR} from .env, so the values match what the
// local containers receive.
const compose = JSON.parse(
  execFileSync("docker", ["compose", "config", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);

const serviceEnvironmentExtra = {};
const serviceSecretValues = {};
for (const service of services) {
  const definition = compose.services?.[service];
  if (!definition) throw new Error(`docker-compose.yml has no service ${service}`);
  serviceEnvironmentExtra[service] = {};
  serviceSecretValues[service] = {};
  // Empty values count as unset in the services (the AI settings, for one), and Secrets Manager rejects empty secrets.
  const environment = { ...definition.environment, ...overrides[service] };
  for (const [key, raw] of Object.entries(environment)) {
    const value = raw == null ? "" : String(raw);
    if (value.trim() === "" || !passesThrough(key)) continue;
    if (isSecret(key)) serviceSecretValues[service][key] = value;
    else serviceEnvironmentExtra[service][key] = value;
  }
}

const dotEnv = readDotEnv();
// The default seed (seed.mjs) needs ADMIN_PASSWORD. The demo seed (seed-demo.mjs) is opt-in and needs
// DEMO_ACCOUNT_PASSWORD, so that one is passed only when .env has it.
const adminPassword = dotEnv.ADMIN_PASSWORD;
if (!adminPassword) throw new Error("ADMIN_PASSWORD must be set in .env for the ops task");
const demoAccountPassword = dotEnv.DEMO_ACCOUNT_PASSWORD;

const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : {};
const imageTag = process.argv[2] ?? previous.image_tag;
if (imageTag !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(imageTag)) {
  throw new Error(`image tag "${imageTag}" is not a valid ECR tag`);
}

const tfvars = {
  service_environment_extra: serviceEnvironmentExtra,
  service_secret_values: serviceSecretValues,
  ops_secret_values: {
    ADMIN_PASSWORD: adminPassword,
    ...(demoAccountPassword === undefined ? {} : { DEMO_ACCOUNT_PASSWORD: demoAccountPassword }),
  },
  ...(imageTag === undefined ? {} : { image_tag: imageTag }),
};
writeFileSync(output, `${JSON.stringify(tfvars, null, 2)}\n`);

for (const service of services) {
  const settings = Object.keys(serviceEnvironmentExtra[service]).length;
  const secrets = Object.keys(serviceSecretValues[service]).length;
  console.log(`${service}: ${settings} settings, ${secrets} secrets`);
}
const tagNote = imageTag === undefined ? "no image_tag" : `image_tag ${imageTag}`;
console.log(`wrote deploy/aws/demo.auto.tfvars.json (${tagNote})`);
