import type { Client } from "minio";
import { describe, expect, it, vi } from "vitest";

import { ProductMediaStore } from "./product-media-store.ts";

const createStore = () => {
  const putObject = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const client = { putObject } as unknown as Client;
  return { putObject, store: new ProductMediaStore(client, "product-media", "http://localhost:9000/product-media/") };
};

describe("ProductMediaStore", () => {
  it("stores supported image bytes with immutable public metadata", async () => {
    const { putObject, store } = createStore();
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const stored = await store.store("00000000-0000-4000-8000-000000000002", image);

    expect(stored.mimeType).toBe("image/jpeg");
    expect(stored.bytes).toBe(image.length);
    expect(stored.imageUrl).toMatch(
      /^http:\/\/localhost:9000\/product-media\/products\/00000000-0000-4000-8000-000000000002\/[0-9a-f-]+\.jpg$/,
    );
    expect(putObject).toHaveBeenCalledWith("product-media", stored.objectKey, image, image.length, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("rejects unsupported image content before storage", async () => {
    const { putObject, store } = createStore();

    await expect(store.store("00000000-0000-4000-8000-000000000002", Buffer.from("not an image"))).rejects.toThrow(
      "Product image must be a JPEG, PNG, or WebP file",
    );
    expect(putObject).not.toHaveBeenCalled();
  });

  it("rejects images larger than five megabytes", async () => {
    const { putObject, store } = createStore();

    await expect(
      store.store("00000000-0000-4000-8000-000000000002", Buffer.alloc(5 * 1024 * 1024 + 1)),
    ).rejects.toThrow("Product image must be 5 MB or smaller");
    expect(putObject).not.toHaveBeenCalled();
  });
});
