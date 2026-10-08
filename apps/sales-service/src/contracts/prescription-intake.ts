import { z } from "zod";

/**
 * Prescription code from Appendix I of Circular 26/2025/TT-BYT: five characters of facility code, seven random
 * `0-9a-z` characters, a dash and a type letter (C ordinary, N narcotic, H psychotropic; Y traditional medicine in
 * the national e-prescription API).
 */
export const prescriptionCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-z]{12}-[cnhy]$/i);

/**
 * What the QR on a printed e-prescription carries in this demo.
 *
 * The real national system (donthuocquocgia.vn) resolves only the 14 character code to the medicines through a
 * pharmacy API that needs vendor credentials. Until those exist the QR carries the same items inline, using the
 * field names of that API's `thong_tin_don_thuoc`, so swapping the inline items for a lookup by `ma_don_thuoc`
 * later does not change anything downstream.
 */
export const prescriptionQrItemSchema = z.object({
  /** Active ingredient(s) as printed, e.g. "Amoxicillin + Acid clavulanic". */
  biet_duoc: z.string().trim().min(1).max(500),
  /** Prescribed name with strength, e.g. "Augmentin 625mg". */
  ten_thuoc: z.string().trim().min(1).max(500),
  don_vi_tinh: z.string().trim().min(1).max(100),
  so_luong: z.number().positive().max(100_000),
  cach_dung: z.string().trim().max(500),
});

export const prescriptionQrPayloadSchema = z.object({
  ma_don_thuoc: prescriptionCodeSchema,
  thong_tin_don_thuoc: z.array(prescriptionQrItemSchema).min(1).max(30),
});

export type PrescriptionQrPayload = z.infer<typeof prescriptionQrPayloadSchema>;

export const prescriptionQrRequestSchema = z.object({ payload: z.string().min(1).max(8_000) });

/** One medicine line as read from a prescription, whether it came from Gemini or from the QR. */
export const extractedLineSchema = z.object({
  /** The line as printed, kept so a shopper can compare it with the suggestions. */
  rawText: z.string().trim().min(1).max(1_000),
  /** Prescribed name; a brand ("Augmentin 625mg") or a generic name ("Paracetamol 500mg"). */
  name: z.string().trim().max(500).nullable(),
  activeIngredients: z.array(z.string().trim().min(1).max(200)).max(10),
  strength: z.string().trim().max(150).nullable(),
  dosageForm: z.string().trim().max(150).nullable(),
  quantity: z.number().positive().max(100_000).nullable(),
  unit: z.string().trim().max(100).nullable(),
  usage: z.string().trim().max(1_000).nullable(),
});

export const prescriptionExtractionSchema = z.object({
  isPrescription: z.boolean(),
  code: z.string().trim().max(50).nullable(),
  patientName: z.string().trim().max(200).nullable(),
  facilityName: z.string().trim().max(300).nullable(),
  doctorName: z.string().trim().max(200).nullable(),
  diagnosis: z.string().trim().max(1_000).nullable(),
  issuedOn: z.string().trim().max(50).nullable(),
  lines: z.array(extractedLineSchema).max(30),
});

export type ExtractedLine = z.infer<typeof extractedLineSchema>;
export type PrescriptionExtraction = z.infer<typeof prescriptionExtractionSchema>;

/** Prescription header fields shown above the suggestions; every one may be missing from the source. */
export type IntakePrescription = Omit<PrescriptionExtraction, "isPrescription" | "lines">;

/** A catalog product suggested for one prescription line. `product` has the shape of `GET /products/:id`. */
export type IntakeMatch = {
  /** `name` when the product name matches the prescribed name, `ingredient` when only the active ingredient does. */
  matchType: "name" | "ingredient";
  /** Whether the strength equals the prescribed one; `null` when either side states none. */
  strengthMatch: boolean | null;
  score: number;
  product: Record<string, unknown>;
};

export type PrescriptionIntakeResult = {
  source: "image" | "qr";
  prescription: IntakePrescription;
  lines: Array<{ extracted: ExtractedLine; matches: IntakeMatch[] }>;
};
