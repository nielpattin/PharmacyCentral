import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
    const endpoint = requiredEnvironmentVariable("SEAWEEDFS_ENDPOINT");
    // One credential pair for the whole repo: the same account the SeaweedFS S3 gateway boots with, so the value
    // can never drift out of sync the way a separately-named copy did.
    const accessKeyId = requiredEnvironmentSecret("SEAWEEDFS_ACCESS_KEY");
    const secretAccessKey = requiredEnvironmentSecret("SEAWEEDFS_SECRET_KEY");
    const bucket = requiredEnvironmentVariable("SEAWEEDFS_MEDIA_BUCKET");
    const publicBaseUrl = requiredEnvironmentVariable("SEAWEEDFS_PUBLIC_MEDIA_URL");

    return new ProductMediaStore(
      new S3Client({
        endpoint,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      }),
      bucket,
      publicBaseUrl,
    );
  }

  private readonly publicBaseUrl: string;

  public constructor(
    private readonly client: Pick<S3Client, "send">,
    private readonly bucket: string,
    publicBaseUrl: string,
  ) {
    this.publicBaseUrl = publicBaseUrl.trim().replace(/\/+$/, "");
  }

  public async store(productId: string, image: Buffer): Promise<StoredProductImage> {
    const signature = detectProductImage(image);
    const sha256 = productImageChecksum(image);
    const objectKey = `products/${productId}/${randomUUID()}.${signature.extension}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: image,
        ContentLength: image.length,
        ContentType: signature.mimeType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    return {
      imageUrl: `${this.publicBaseUrl}/${objectKey}`,
      objectKey,
      mimeType: signature.mimeType,
      bytes: image.length,
      sha256,
    };
  }
}
