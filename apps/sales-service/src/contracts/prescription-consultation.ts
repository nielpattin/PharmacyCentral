import { z } from "zod";

import { extractedLineSchema, prescriptionExtractionSchema } from "./prescription-intake.ts";

export const consultationLineSchema = extractedLineSchema.extend({
  /** Set by the shopper's page when no suggestion could fill the line as prescribed at the chosen store. */
  needsHelp: z.boolean(),
});
export const consultationPrescriptionSchema = prescriptionExtractionSchema.omit({ isPrescription: true, lines: true });
export const createPrescriptionConsultationRequestSchema = z.object({
  source: z.enum(["image", "qr"]),
  /** The store the shopper had chosen on the intake page, when any. */
  siteId: z.string().uuid().nullable(),
  prescription: consultationPrescriptionSchema,
  lines: z.array(consultationLineSchema).min(1).max(30),
  note: z.string().trim().max(1000).nullable(),
});
export const answerPrescriptionConsultationRequestSchema = z.object({ reply: z.string().trim().min(1).max(2000) });
export const prescriptionConsultationStatuses = ["Open", "Answered"] as const;
export type PrescriptionConsultationStatus = (typeof prescriptionConsultationStatuses)[number];
export type ConsultationLine = z.infer<typeof consultationLineSchema>;
export type PrescriptionConsultation = {
  id: string;
  customerId: string;
  siteId: string | null;
  source: "image" | "qr";
  prescription: z.infer<typeof consultationPrescriptionSchema>; // { code, patientName, facilityName, doctorName, diagnosis, issuedOn }, each string | null
  lines: ConsultationLine[];
  note: string | null;
  status: PrescriptionConsultationStatus;
  reply: string | null;
  answeredBy: string | null;
  answeredAt: string | null; // ISO 8601
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
};
