// Environment and scenario profiles shared by every k6 script under tools/k6.

/** Reads a required `__ENV` value when called and throws naming the variable if it is missing or empty. */
export function required(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Gateway base URL without a trailing slash; every request goes through it with the `/api` prefix. */
export function targetUrl() {
  return required("LOAD_TARGET_URL").replace(/\/+$/, "");
}

/** Password shared by the demo accounts. */
export function demoPassword() {
  return required("DEMO_ACCOUNT_PASSWORD");
}

/** HMAC secret that signs SePay webhook bodies. */
export function sepayWebhookSecret() {
  return required("SEPAY_WEBHOOK_SECRET");
}

/** Demo accounts seeded by identity-service. */
export const accounts = Object.freeze({
  customer: "khachhang@pharmacycentral.vn",
  admin: "admin@pharmacycentral.vn",
  manager: "manager@pharmacycentral.vn",
  pharmacist: "pharmacist@pharmacycentral.vn",
  warehouse: "warehouse@pharmacycentral.vn",
});

const SCENARIO_SHAPES = Object.freeze({
  smoke: { executor: "shared-iterations", vus: 1, iterations: 1, maxDuration: "5m" },
  load: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "20s", target: 10 },
      { duration: "80s", target: 10 },
      { duration: "20s", target: 0 },
    ],
    gracefulRampDown: "30s",
  },
  stress: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "30s", target: 20 },
      { duration: "60s", target: 50 },
      { duration: "60s", target: 50 },
      { duration: "30s", target: 0 },
    ],
    gracefulRampDown: "30s",
  },
  // Steps up every minute until a script's abortOnFail threshold stops the run: the VU count where it stops is the
  // limit of the deployment under test. Use it against the aws-like stack, never against a shared environment.
  breakpoint: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [20, 40, 60, 80, 100, 130, 160, 200, 250, 300].flatMap((target) => [
      { duration: "15s", target },
      { duration: "45s", target },
    ]),
    gracefulRampDown: "30s",
  },
});

/** Profile from `-e PROFILE=smoke|load|stress|breakpoint`. Defaults to `smoke`, the single-iteration run, when unset. */
export function profile() {
  const name = __ENV.PROFILE || "smoke";
  if (!Object.keys(SCENARIO_SHAPES).includes(name)) {
    throw new Error(`Unknown PROFILE "${name}": expected one of ${Object.keys(SCENARIO_SHAPES).join(", ")}`);
  }
  return name;
}

/** Executor options for a profile; a scenario places them under its own key in `options.scenarios`. */
export function scenarioOptions(name = profile()) {
  if (!Object.keys(SCENARIO_SHAPES).includes(name)) throw new Error(`Unknown PROFILE "${name}"`);
  return { ...SCENARIO_SHAPES[name] };
}
