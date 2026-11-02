// Fault injection against a deployed ECS stack (deploy/aws): scale a service to zero, stop its tasks, reboot the Redis
// node. Everything goes through the AWS CLI with the `pharmacy` profile; the local dummy keys of .env are cleared so
// they never reach AWS.
import { exec, firstLine } from "./exec.mjs";

const REGION = "us-east-1";
const CLUSTER = "pharmacy-central-staging";
const PREFIX = `${CLUSTER}-`;
const ENV = {
  AWS_PROFILE: "pharmacy",
  AWS_DEFAULT_REGION: REGION,
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_SESSION_TOKEN: "",
  AWS_ENDPOINT_URL: "",
  AWS_ENDPOINT_URL_S3: "",
  AWS_PAGER: "",
};

export async function aws(args, { json = true } = {}) {
  const result = await exec("aws", [...args, ...(json ? ["--output", "json"] : [])], { env: ENV, timeoutMs: 180_000 });
  if (result.code !== 0) throw new Error(`aws ${args.slice(0, 3).join(" ")} failed: ${firstLine(result.stderr)}`);
  return json && result.stdout.trim() !== "" ? JSON.parse(result.stdout) : result.stdout;
}

const serviceName = (service) => `${PREFIX}${service}`;
const resourceId = (service) => `service/${CLUSTER}/${serviceName(service)}`;

async function describe(service) {
  const out = await aws(["ecs", "describe-services", "--cluster", CLUSTER, "--services", serviceName(service)]);
  const found = out.services?.[0];
  if (!found) throw new Error(`ECS service ${serviceName(service)} not found`);
  return found;
}

/** The scalable target of a service (autoscaled backends), or undefined. */
async function scalableTarget(service) {
  const out = await aws([
    "application-autoscaling",
    "describe-scalable-targets",
    "--service-namespace",
    "ecs",
    "--resource-ids",
    resourceId(service),
  ]);
  return out.ScalableTargets?.[0];
}

const setScalable = (service, min, max) =>
  aws(
    [
      "application-autoscaling",
      "register-scalable-target",
      "--service-namespace",
      "ecs",
      "--scalable-dimension",
      "ecs:service:DesiredCount",
      "--resource-id",
      resourceId(service),
      "--min-capacity",
      String(min),
      "--max-capacity",
      String(max),
    ],
    { json: false },
  );

/** Task state of a service: `{ desired, running, pending, healthy }`. A task counts as healthy when RUNNING and not UNHEALTHY. */
export async function status(service) {
  const svc = await describe(service);
  const listed = await aws(["ecs", "list-tasks", "--cluster", CLUSTER, "--service-name", serviceName(service)]);
  let healthy = 0;
  if (listed.taskArns?.length) {
    const tasks = await aws(["ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", ...listed.taskArns]);
    healthy = tasks.tasks.filter((t) => t.lastStatus === "RUNNING" && t.healthStatus !== "UNHEALTHY").length;
  }
  return { desired: svc.desiredCount, running: svc.runningCount, pending: svc.pendingCount, healthy };
}

/** Controls one service. `remember` is where the original sizes are kept so `start` can put them back. */
export function createEcs({ note, onCleanup }) {
  const original = new Map();

  async function stop(service) {
    const svc = await describe(service);
    const target = await scalableTarget(service);
    original.set(service, { desired: svc.desiredCount, min: target?.MinCapacity, max: target?.MaxCapacity });
    onCleanup(`restore ${service} to ${svc.desiredCount} task(s)`, () => start(service));
    note(`scale ${service} to 0 (was ${svc.desiredCount})`);
    // Application Auto Scaling would raise the count back to its minimum, so the minimum goes to 0 first.
    if (target) await setScalable(service, 0, target.MaxCapacity);
    await aws([
      "ecs",
      "update-service",
      "--cluster",
      CLUSTER,
      "--service",
      serviceName(service),
      "--desired-count",
      "0",
    ]);
  }

  async function start(service) {
    const saved = original.get(service);
    if (!saved) return;
    note(`scale ${service} back to ${saved.desired}`);
    await aws([
      "ecs",
      "update-service",
      "--cluster",
      CLUSTER,
      "--service",
      serviceName(service),
      "--desired-count",
      String(saved.desired),
    ]);
    if (saved.min !== undefined) await setScalable(service, saved.min, saved.max);
    original.delete(service);
  }

  /** Stops every running task of the service. ECS sends SIGTERM and then SIGKILL after the stop timeout, and starts replacements. */
  async function killTasks(service) {
    const listed = await aws(["ecs", "list-tasks", "--cluster", CLUSTER, "--service-name", serviceName(service)]);
    note(`stop ${listed.taskArns.length} task(s) of ${service}`);
    for (const arn of listed.taskArns) {
      await aws(["ecs", "stop-task", "--cluster", CLUSTER, "--task", arn, "--reason", "chaos sales-kill"]);
    }
    return listed.taskArns.length;
  }

  async function waitHealthy(service, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    const want = original.get(service)?.desired ?? (await describe(service)).desiredCount;
    let last;
    for (;;) {
      last = await status(service);
      if (last.healthy >= Math.max(want, 1) && last.pending === 0) return last;
      if (Date.now() >= deadline)
        throw new Error(`${service} not healthy in ${timeoutMs / 1000}s: ${JSON.stringify(last)}`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  async function rebootRedis() {
    note("reboot the ElastiCache Redis node");
    await aws(
      ["elasticache", "reboot-cache-cluster", "--cache-cluster-id", CLUSTER, "--cache-node-ids-to-reboot", "0001"],
      {
        json: false,
      },
    );
  }

  async function redisAvailable() {
    const out = await aws(["elasticache", "describe-cache-clusters", "--cache-cluster-id", CLUSTER]);
    return out.CacheClusters[0].CacheClusterStatus;
  }

  return { stop, start, killTasks, waitHealthy, status, rebootRedis, redisAvailable };
}
