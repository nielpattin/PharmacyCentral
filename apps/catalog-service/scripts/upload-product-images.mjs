import { readdir, readFile } from "node:fs/promises";
import { extname, join, parse } from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { requiredEnvironmentSecret, requiredEnvironmentVariable } from "../src/shared/infrastructure/environment.ts";
import { detectProductImage, productImageChecksum } from "../src/modules/catalog/product-image.ts";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export const uploadProductImages = async (directory) => {
  const bucket = requiredEnvironmentVariable("SEAWEEDFS_MEDIA_BUCKET");
  const publicBaseUrl = requiredEnvironmentVariable("SEAWEEDFS_PUBLIC_MEDIA_URL").trim().replace(/\/+$/, "");
  const client = new S3Client({
    endpoint: requiredEnvironmentVariable("SEAWEEDFS_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnvironmentSecret("SEAWEEDFS_ACCESS_KEY"),
      secretAccessKey: requiredEnvironmentSecret("SEAWEEDFS_SECRET_KEY"),
    },
  });

  const files = (await readdir(directory)).filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase())).sort();
  if (files.length === 0) throw new Error(`No product images found in ${directory}`);

  const images = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(join(directory, file));
      const { mimeType, extension } = detectProductImage(content);
      const sku = parse(file).name;
      const objectKey = `product-images/${sku}/${productImageChecksum(content)}.${extension}`;
      return { sku, objectKey, mimeType, content, imageUrl: `${publicBaseUrl}/${objectKey}` };
    }),
  );

  for (const { objectKey, mimeType, content } of images) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: content,
        ContentLength: content.length,
        ContentType: mimeType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }
  return images.map(({ sku, imageUrl }) => ({ sku, imageUrl }));
};
