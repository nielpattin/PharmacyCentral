// Uploads data/product-images/images to the AWS media bucket under the content-hash keys products.csv expects
// (product-images/<SKU>/<sha256>.<ext>), then writes tmp/aws-demo/products.csv: the same CSV with its image URLs moved to
// the public media bucket URL. Import that copy in staff-web, not the original, or the product images do not resolve.
//
// Usage: node --env-file=.env tools/aws-upload-media.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

const awsDir = fileURLToPath(new URL("../deploy/aws", import.meta.url));
const imageDir = fileURLToPath(new URL("../data/product-images/images", import.meta.url));
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
const IMMUTABLE = "public, max-age=31536000, immutable";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  return value;
};

// Same signatures and limits as apps/catalog-service/src/modules/catalog/product-image.ts.
const detectProductImage = (content) => {
  if (content.length === 0) throw new Error("Product image is empty");
  if (content.length > MAX_BYTES) throw new Error("Product image must be 5 MB or smaller");
  if (content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return { extension: "jpg", mimeType: "image/jpeg" };
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { extension: "png", mimeType: "image/png" };
  if (content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP")
    return { extension: "webp", mimeType: "image/webp" };
  throw new Error("Product image must be a JPEG, PNG, or WebP file");
};

const terraform = spawnSync("terraform", [`-chdir=${awsDir}`, "output", "-json", "web"], { encoding: "utf8" });
if (terraform.status !== 0) throw new Error(`terraform output web failed: ${terraform.stderr}`);
const web = JSON.parse(terraform.stdout);
const mediaBase = web.media_base_url;

const files = readdirSync(imageDir)
  .filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
  .sort();
if (files.length === 0) throw new Error(`No product images found in ${imageDir}`);

for (const file of files) {
  const path = join(imageDir, file);
  const content = readFileSync(path);
  const { extension, mimeType } = detectProductImage(content);
  const sku = parse(file).name;
  const key = `product-images/${sku}/${createHash("sha256").update(content).digest("hex")}.${extension}`;
  const result = spawnSync(
    "aws",
    [
      "s3api",
      "put-object",
      "--bucket",
      web.media_bucket,
      "--key",
      key,
      "--body",
      path,
      "--content-type",
      mimeType,
      "--cache-control",
      IMMUTABLE,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  if (result.status !== 0) throw new Error(`uploading ${key} failed: ${result.stderr}`);
  console.log(`uploaded ${key}`);
}

const localMediaBase = required("SEAWEEDFS_PUBLIC_MEDIA_URL").trim().replace(/\/+$/, "");
const csv = readFileSync(new URL("../data/import-samples/products.csv", import.meta.url), "utf8");
const rewritten = csv.replaceAll(`${localMediaBase}/`, `${mediaBase}/`);
if (rewritten === csv) throw new Error(`products.csv has no image URL under ${localMediaBase}/`);
const outDir = fileURLToPath(new URL("../tmp/aws-demo/", import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "products.csv"), rewritten);
console.log(`wrote ${join(outDir, "products.csv")}: import this file in staff-web Data import`);
