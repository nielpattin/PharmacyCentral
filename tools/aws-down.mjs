// Takes the AWS demo stack down. Usage:
//   node tools/aws-down.mjs            pause: stop RDS and destroy only what bills by the hour (NAT, EIP, both ALBs,
//                                      ElastiCache, ECS services via their dependencies). VPC, RDS data, ECR, SSM, S3
//                                      and IAM stay. Resume with `pnpm run cloud:deploy`.
//   node tools/aws-down.mjs --destroy  destroy everything, RDS data included (asks for confirmation).
// RDS restarts by itself after 7 stopped days; pause again if the demo is further away than that.
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const destroyAll = process.argv.includes("--destroy");
const aws = ["--profile", "pharmacy", "--region", "us-east-1"];
const env = {
  ...process.env,
  AWS_PROFILE: "pharmacy",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_ENDPOINT_URL_S3: "",
};
const tf = (...a) => execFileSync("node", ["tools/aws-tf.mjs", ...a], { stdio: "inherit", env });
// image_tag only has to be set; destroy does not use its value.
const common = ["-auto-approve", "-var=image_tag=down", "-var=services_enabled=true"];

if (destroyAll) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "This deletes ALL AWS resources including the database. Type 'destroy' to continue: ",
  );
  rl.close();
  if (answer.trim() !== "destroy") {
    console.log("Aborted.");
    process.exit(1);
  }
  tf("destroy", ...common);
  console.log("Destroyed. Remove leftover DNS records in Cloudflare if any remain.");
} else {
  // The Cloudflare records are targeted too: they point at the ALB being destroyed, and leaving them outside the state
  // makes the next apply fail with "didn't find an exact match".
  const targets = [
    "aws_lb.internal",
    "aws_lb.web",
    "aws_elasticache_cluster.this",
    "aws_nat_gateway.this",
    "aws_eip.nat",
    "cloudflare_record.site",
    "cloudflare_record.grafana",
    "cloudflare_record.certificate_validation",
  ].map((t) => `-target=${t}`);
  tf("destroy", ...common, ...targets);
  const status = execFileSync(
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
    { encoding: "utf8", env },
  ).trim();
  if (status === "available") {
    execFileSync("aws", [...aws, "rds", "stop-db-instance", "--db-instance-identifier", "pharmacy-central-staging"], {
      stdio: "inherit",
      env,
    });
  } else {
    console.log(`RDS is ${status}, not stopping it`);
  }
  console.log("Paused. Resume with: pnpm run cloud:deploy");
}
