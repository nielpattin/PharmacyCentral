import { createHmac, timingSafeEqual } from "node:crypto";

export class SePayWebhookVerifier {
  public constructor(private readonly secret: string) {}

  public verify(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
    if (!this.secret || !signatureHeader) return false;
    const provided = signatureHeader
      .trim()
      .replace(/^sha256=/i, "")
      .toLowerCase();
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const expectedBytes = Buffer.from(expected, "utf8");
    const providedBytes = Buffer.from(provided, "utf8");
    return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
  }
}
