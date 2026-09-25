import { randomUUID } from "node:crypto";

import { Client } from "minio";

import { requiredEnvironmentSecret, requiredEnvironmentVariable } from "../../shared/infrastructure/environment.ts";

import { detectProductImage, productImageChecksum } from "./product-image.ts";

export type StoredProductImage = {
  imageUrl: string;
  objectKey: string;
  mimeType: string;
  bytes: number;
  sha256: string;
};

export class ProductMediaStore {
  public static createFromEnvironment(): ProductMediaStore {
    const endpoint = requiredEnvironmentVariable("MINIO_ENDPOINT");
    const accessKey = requiredEnvironmentSecret("MINIO_ACCESS_KEY");
    const secretKey = requiredEnvironmentSecret("MINIO_SECRET_KEY");
    const bucket = requiredEnvironmentVariable("MINIO_MEDIA_BUCKET");
    const publicBaseUrl = requiredEnvironmentVariable("MINIO_PUBLIC_MEDIA_URL");
    const separator = endpoint.lastIndexOf(":");
    const host = endpoint.slice(0, separator);
    const port = Number.parseInt(endpoint.slice(separator + 1), 10);
    if (!separator || !host || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("MINIO_ENDPOINT must use host:port format");
    }

    return new ProductMediaStore(
      new Client({ endPoint: host, port, useSSL: false, accessKey, secretKey }),
      bucket,
      publicBaseUrl,
    );
  }

  private readonly publicBaseUrl: string;

  public constructor(
    private readonly client: Client,
    private readonly bucket: string,
    publicBaseUrl: string,
  ) {
    this.publicBaseUrl = publicBaseUrl.trim().replace(/\/+$/, "");
  }

  public async store(productId: string, image: Buffer): Promise<StoredProductImage> {
    const signature = detectProductImage(image);
    const sha256 = productImageChecksum(image);
    const objectKey = `products/${productId}/${randomUUID()}.${signature.extension}`;
    await this.client.putObject(this.bucket, objectKey, image, image.length, {
      "Content-Type": signature.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });

    return {
      imageUrl: `${this.publicBaseUrl}/${objectKey}`,
      objectKey,
      mimeType: signature.mimeType,
      bytes: image.length,
      sha256,
    };
  }
}
