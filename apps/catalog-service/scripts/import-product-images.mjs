/**
 * Upload the product-image archive to the media bucket and print one `sku,imageUrl` line per image.
 *
 *   pnpm run images:import
 *
 * The archive is data/product-images/images.tar.gz and every member is named `<SKU>.<ext>`, so the
 * object key is `product-images/<SKU>/<sha256>.<ext>` and the URL is reproducible.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { requiredEnvironmentSecret, requiredEnvironmentVariable } from "../src/shared/infrastructure/environment.ts";
import { detectProductImage, productImageChecksum } from "../src/modules/catalog/product-image.ts";

const ARCHIVE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/product-images/images.tar.gz");

const createStorage = () => ({
  bucket: requiredEnvironmentVariable("SEAWEEDFS_MEDIA_BUCKET"),
  publicBaseUrl: requiredEnvironmentVariable("SEAWEEDFS_PUBLIC_MEDIA_URL").trim().replace(/\/+$/, ""),
  client: new S3Client({
    endpoint: requiredEnvironmentVariable("SEAWEEDFS_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnvironmentSecret("SEAWEEDFS_ACCESS_KEY"),
      secretAccessKey: requiredEnvironmentSecret("SEAWEEDFS_SECRET_KEY"),
    },
  }),
});

const readTarMembers = (archive) => {
  const members = [];
  const field = (header, start, length) =>
    header
      .subarray(start, start + length)
      .toString("utf8")
      .replace(/\0.*$/s, "")
      .trim();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12) || "0", 8) || 0;
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const prefix = field(header, 345, 155);
    const path = prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100);
    const content = archive.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (typeflag === "0" || typeflag === "\0") members.push({ path, content });
  }
  return members;
};

const storage = createStorage();

const images = readTarMembers(gunzipSync(await readFile(ARCHIVE_PATH))).map(({ path, content }) => {
  const file = path.split("/").pop();
  const { mimeType, extension } = detectProductImage(content);
  const sku = file.slice(0, file.lastIndexOf("."));
  const objectKey = `product-images/${sku}/${productImageChecksum(content)}.${extension}`;
  return { sku, objectKey, mimeType, content, imageUrl: `${storage.publicBaseUrl}/${objectKey}` };
});

for (const { objectKey, mimeType, content } of images) {
  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      Body: content,
      ContentLength: content.length,
      ContentType: mimeType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

process.stdout.write(images.map(({ sku, imageUrl }) => `${sku},${imageUrl}\n`).join(""));
