import {
  prescriptionQrPayloadSchema,
  type ExtractedLine,
  type PrescriptionQrPayload,
} from "../../../contracts/prescription-intake.ts";

const STRENGTH = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|ug|g|ml|iu|ui|%)(?!\p{L})/giu;

/** Parses the text a scanned QR carries; `undefined` when it is not JSON or not an e-prescription payload. */
export const parsePrescriptionQr = (payload: string): PrescriptionQrPayload | undefined => {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return undefined;
  }
  const parsed = prescriptionQrPayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
};

/** The QR items in the shape the image reader produces, so both sources go through the same matching. */
export const linesFromQr = (payload: PrescriptionQrPayload): ExtractedLine[] =>
  payload.thong_tin_don_thuoc.map((item) => ({
    rawText: item.ten_thuoc === item.biet_duoc ? item.ten_thuoc : `${item.ten_thuoc} (${item.biet_duoc})`,
    name: item.ten_thuoc,
    // "Amoxicillin + Acid clavulanic" or "Amoxicillin, Acid clavulanic" -> one entry per ingredient.
    activeIngredients: item.biet_duoc
      .split(/[+,;]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
    // The brand's own strength wins ("Augmentin 625mg"); a bare "Hapacol 650" falls back to the one its ingredient states.
    strength: (item.ten_thuoc.match(STRENGTH) ?? item.biet_duoc.match(STRENGTH))?.join(" + ") ?? null,
    dosageForm: null,
    quantity: item.so_luong,
    unit: item.don_vi_tinh,
    usage: item.cach_dung || null,
  }));
