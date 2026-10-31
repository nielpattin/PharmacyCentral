import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
if (!cloudflareToken) {
  try {
    const certPath = join(homedir(), ".cloudflared", "cert.pem");
    const cert = readFileSync(certPath, "utf8");
    const m = cert.match(/-----BEGIN ARGO TUNNEL TOKEN-----\s*([A-Za-z0-9+/=\s]+)/);
    if (m) {
      const data = JSON.parse(Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8"));
      cloudflareToken = data.apiToken;
    }
  } catch {}
}

const args = process.argv.slice(2);
const env = {
  ...process.env,
  AWS_PROFILE: "pharmacy",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_ENDPOINT_URL_S3: "",
  CLOUDFLARE_API_TOKEN: cloudflareToken,
};

try {
  execFileSync("terraform", ["-chdir=deploy/aws", ...args], {
    env,
    stdio: "inherit",
  });
} catch (err) {
  process.exit(err.status ?? 1);
}
