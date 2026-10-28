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
    // The standard AWS SDK names. Locally they point at Floci (http://localhost:4566, dummy keys); on AWS the endpoint
    // is the regional S3 endpoint and the keys belong to the scoped IAM user.
    const endpoint = requiredEnvironmentVariable("AWS_ENDPOINT_URL_S3");
    const region = requiredEnvironmentVariable("AWS_REGION");
    const accessKeyId = requiredEnvironmentSecret("AWS_ACCESS_KEY_ID");
    const secretAccessKey = requiredEnvironmentSecret("AWS_SECRET_ACCESS_KEY");
    const bucket = requiredEnvironmentVariable("MEDIA_BUCKET");
    const publicBaseUrl = requiredEnvironmentVariable("PUBLIC_MEDIA_URL");

    return new ProductMediaStore(
      new S3Client({
        endpoint,
        region,
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
