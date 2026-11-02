// Builds the backend images with docker compose and the ops image from deploy/aws/ops, then pushes all of them to the
// ECR repositories Terraform created. Usage: node tools/aws-push-images.mjs <imageTag>
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tag = process.argv[2];
if (!tag || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
  throw new Error("Usage: node tools/aws-push-images.mjs <imageTag>");
}

const root = fileURLToPath(new URL("..", import.meta.url));
const region = "us-east-1";
// Images are built for the Fargate runtime (x86_64) even on another host.
// COMPOSE_PARALLEL_LIMIT keeps the 11 builds from running at once: each runs nx and a bundler, and all of them together
// exhaust the memory of a laptop (a full parallel build got the deploy killed). Raise it with the same variable if the
// machine has the room.
const buildEnv = {
  ...process.env,
  DOCKER_DEFAULT_PLATFORM: "linux/amd64",
  COMPOSE_PARALLEL_LIMIT: process.env.COMPOSE_PARALLEL_LIMIT ?? "2",
};
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });

const repositories = JSON.parse(
  execFileSync("terraform", ["-chdir=deploy/aws", "output", "-json", "ecr_repository_urls"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
const services = Object.keys(repositories).filter((service) => service !== "ops");

const password = execFileSync("aws", ["ecr", "get-login-password", "--region", region], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
}).trim();
execFileSync("docker", ["login", "--username", "AWS", "--password-stdin", repositories.ops.split("/")[0]], {
  input: password,
  stdio: ["pipe", "inherit", "inherit"],
});

// Rebuild rather than reuse: docker layer cache keeps this quick, and a stale image would ship old code.
run("docker", ["compose", "build", ...services], { env: buildEnv });
const compose = JSON.parse(
  execFileSync("docker", ["compose", "config", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
for (const service of services) {
  const localImage = compose.services[service].image ?? `${compose.name}-${service}`;
  run("docker", ["tag", localImage, `${repositories[service]}:${tag}`]);
}

run("docker", ["build", "-f", "deploy/aws/ops/Dockerfile", "-t", `${repositories.ops}:${tag}`, "."], { env: buildEnv });

for (const service of [...services, "ops"]) {
  run("docker", ["push", `${repositories[service]}:${tag}`]);
}
console.log(`pushed ${services.length + 1} images with tag ${tag}`);
