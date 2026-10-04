import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { ProductMediaStore } from "./product-media-store.ts";

const createStore = () => {
  const send = vi.fn<(command: PutObjectCommand) => Promise<unknown>>().mockResolvedValue({});
  const client = { send } as unknown as S3Client;
  return { send, store: new ProductMediaStore(client, "product-media", "http://localhost:9000/product-media/") };
};

describe("ProductMediaStore", () => {
  it("stores supported image bytes with immutable public metadata", async () => {
    const { send, store } = createStore();
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const stored = await store.store("00000000-0000-4000-8000-000000000002", image);

    expect(stored.mimeType).toBe("image/jpeg");
    expect(stored.bytes).toBe(image.length);
    expect(stored.imageUrl).toMatch(
      /^http:\/\/localhost:9000\/product-media\/products\/00000000-0000-4000-8000-000000000002\/[0-9a-f-]+\.jpg$/,
    );
    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]![0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: "product-media",
      Key: stored.objectKey,
      Body: image,
      ContentLength: image.length,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    });
  });

  it("rejects unsupported image content before storage", async () => {
    const { send, store } = createStore();

    await expect(store.store("00000000-0000-4000-8000-000000000002", Buffer.from("not an image"))).rejects.toThrow(
      "Product image must be a JPEG, PNG, or WebP file",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects images larger than five megabytes", async () => {
    const { send, store } = createStore();

    await expect(
      store.store("00000000-0000-4000-8000-000000000002", Buffer.alloc(5 * 1024 * 1024 + 1)),
    ).rejects.toThrow("Product image must be 5 MB or smaller");
    expect(send).not.toHaveBeenCalled();
  });
});
