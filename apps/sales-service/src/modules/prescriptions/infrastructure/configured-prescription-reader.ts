import type { PrescriptionExtraction } from "../../../contracts/prescription-intake.ts";
import { PrescriptionReaderError, type ImageMimeType, type PrescriptionReader } from "../domain/prescription-reader.ts";

export type PrescriptionAdapter = Pick<PrescriptionReader, "read">;

export class ConfiguredPrescriptionReader implements PrescriptionReader {
  public constructor(private readonly source: () => Promise<PrescriptionAdapter | undefined>) {}

  public async isAvailable(): Promise<boolean> {
    try {
      return (await this.source()) !== undefined;
    } catch {
      return false;
    }
  }

  public async read(image: Buffer, mimeType: ImageMimeType): Promise<PrescriptionExtraction> {
    let adapter: PrescriptionAdapter | undefined;
    try {
      adapter = await this.source();
    } catch (cause) {
      throw new PrescriptionReaderError("unavailable", "The AI provider settings could not be read", { cause });
    }
    if (!adapter) {
      throw new PrescriptionReaderError("unavailable", "No AI provider is configured");
    }
    return adapter.read(image, mimeType);
  }
}
