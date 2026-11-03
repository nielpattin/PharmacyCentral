// One command to bring the AWS demo stack up. Usage:
//   node tools/aws-deploy.mjs [--fresh] [--tag <imageTag>] [--build]
// Images are built by GitHub Actions when a version tag is pushed (git tag vX.Y.Z), never on this machine. The tag
// defaults to the latest version tag of this repository. --build is the escape hatch that builds and pushes the images
// locally under the tag given with --tag.
// Default (stack already exists, or is paused): start RDS if stopped, check the tag is in ECR, apply with services on.
// --fresh (nothing deployed yet): apply infra without services, check the images, run databases and migrations on ECS,
// start the services, then load the demo data (tools/aws-seed.mjs).
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const tagIndex = args.indexOf("--tag");
const build = args.includes("--build");
const latestVersionTag = () => {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No version tag found. Create one with: git tag vX.Y.Z && git push origin vX.Y.Z");
  }
};
const tag = tagIndex >= 0 ? args[tagIndex + 1] : latestVersionTag();

const aws = ["--profile", "pharmacy", "--region", "us-east-1"];
const awsEnv = {
  ...process.env,
  AWS_PROFILE: "pharmacy",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_ENDPOINT_URL_S3: "",
};
const step = (title) => console.log(`\n=== ${title} ===`);
const node = (...a) => execFileSync("node", a, { stdio: "inherit", env: awsEnv });
const tf = (...a) => node("tools/aws-tf.mjs", ...a);
const apply = (servicesEnabled) =>
  tf("apply", "-auto-approve", `-var=image_tag=${tag}`, `-var=services_enabled=${servicesEnabled}`);

const rdsStatus = () => {
  try {
    return execFileSync(
      "aws",
      [
        ...aws,
        "rds",
        "describe-db-instances",
        "--db-instance-identifier",
        "pharmacy-central-staging",
        "--query",
        "DBInstances[0].DBInstanceStatus",
        "--output",
        "text",
      ],
      { encoding: "utf8", env: awsEnv, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }
};

const tagPushed = () => {
  try {
    const repos = JSON.parse(
      execFileSync("node", ["tools/aws-tf.mjs", "output", "-json", "ecr_repository_urls"], {
        encoding: "utf8",
        env: awsEnv,
      }),
    );
    execFileSync(
      "aws",
      [
        ...aws,
        "ecr",
        "describe-images",
        "--repository-name",
        repos.ops.split("/").slice(1).join("/"),
        "--image-ids",
        `imageTag=${tag}`,
      ],
      { env: awsEnv, stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
};

const ensureImages = () => {
  if (tagPushed()) return console.log(`tag ${tag} is in ECR`);
  if (build) return node("tools/aws-push-images.mjs", tag);
  throw new Error(
    `Tag ${tag} is not in ECR. GitHub builds it when the tag is pushed: check "gh run list --workflow release.yml", ` +
      `or rerun the release run of ${tag} if ECR was recreated. --build --tag <name> builds on this machine instead.`,
  );
};

console.log(`image tag: ${tag}${fresh ? " (fresh deploy)" : ""}`);

step("1/5 Service settings");
node("tools/aws-env.mjs", tag);

if (fresh) {
  step("2/5 Infrastructure (RDS takes ~15 minutes)");
  apply(false);
  step("3/5 Images");
  ensureImages();
  step("4/5 Databases, migrations and seeds");
  node("tools/aws-migrate.mjs");
} else {
  step("2/5 Database");
  if (rdsStatus() === "stopped") {
    execFileSync("aws", [...aws, "rds", "start-db-instance", "--db-instance-identifier", "pharmacy-central-staging"], {
      env: awsEnv,
      stdio: "inherit",
    });
    execFileSync(
      "aws",
      [...aws, "rds", "wait", "db-instance-available", "--db-instance-identifier", "pharmacy-central-staging"],
      { env: awsEnv, stdio: "inherit" },
    );
  } else {
    console.log("RDS already running");
  }
  step("3/5 Images");
  ensureImages();
  step("4/5 Migrations");
  console.log("skipped (use --fresh for a new stack)");
}

step("5/5 Start services");
apply(true);

if (fresh) {
  step("Demo data");
  node("tools/aws-seed.mjs");
}

step("Done");
tf("output", "web");
