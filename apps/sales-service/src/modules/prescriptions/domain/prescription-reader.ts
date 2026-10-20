import type { PrescriptionExtraction } from "../../../contracts/prescription-intake.ts";

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** Turns the photo of a printed prescription into structured medicine lines. */
export interface PrescriptionReader {
  read(image: Buffer, mimeType: ImageMimeType): Promise<PrescriptionExtraction>;
  isAvailable(): Promise<boolean>;
}

/**
 * The reader could not produce lines: `unavailable` when the provider failed or refused (retrying later may work),
 * `unreadable` when it answered with something that is not a prescription extraction.
 */
export class PrescriptionReaderError extends Error {
  public constructor(
    public readonly kind: "unavailable" | "unreadable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PrescriptionReaderError";
  }
}

const MAGIC_BYTES: Record<ImageMimeType, (image: Buffer) => boolean> = {
  "image/jpeg": (image) => image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff,
  "image/png": (image) => image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (image) =>
    image.subarray(0, 4).toString("latin1") === "RIFF" && image.subarray(8, 12).toString("latin1") === "WEBP",
};

/** The content type is the client's claim; the provider rejects an image whose bytes disagree with it. */
export const isImageOfType = (image: Buffer, mimeType: ImageMimeType): boolean => MAGIC_BYTES[mimeType](image);
