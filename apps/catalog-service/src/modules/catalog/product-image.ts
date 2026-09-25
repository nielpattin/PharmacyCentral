import { createHash } from "node:crypto";

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export type ProductImageSignature = {
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

const signatures: Array<ProductImageSignature & { test: (body: Buffer) => boolean }> = [
  {
    extension: "jpg",
    mimeType: "image/jpeg",
    test: (body) => body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  },
  {
    extension: "png",
    mimeType: "image/png",
    test: (body) => body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extension: "webp",
    mimeType: "image/webp",
    test: (body) =>
      body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export const detectProductImage = (body: Buffer): ProductImageSignature => {
  if (body.length === 0) throw new Error("Product image is empty");
  if (body.length > MAX_PRODUCT_IMAGE_BYTES) throw new Error("Product image must be 5 MB or smaller");
  const signature = signatures.find((candidate) => candidate.test(body));
  if (!signature) throw new Error("Product image must be a JPEG, PNG, or WebP file");
  return { extension: signature.extension, mimeType: signature.mimeType };
};

export const productImageChecksum = (body: Buffer): string => createHash("sha256").update(body).digest("hex");
