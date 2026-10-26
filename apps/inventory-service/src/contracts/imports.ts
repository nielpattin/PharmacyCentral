import { z } from "zod";

export const importSchemaVersion = 1 as const;

const hasOneReference = (value: { id?: string | undefined; code?: string | undefined }): boolean =>
  Boolean(value.id) !== Boolean(value.code);

export const openingBalanceImportRowSchema = z
  .object({
    productId: z.string().uuid().optional(),
    productSku: z.string().trim().min(1).max(100).optional(),
    siteId: z.string().uuid().optional(),
    siteCode: z.string().trim().min(1).max(50).optional(),
    storageLocationId: z.string().uuid().optional(),
    storageLocationCode: z.string().trim().min(1).max(50).optional(),
    supplierId: z.string().uuid().nullable().optional(),
    supplierCode: z.string().trim().min(1).max(50).nullable().optional(),
    batchNumber: z.string().trim().min(1).max(100),
    quantityOnHand: z.coerce
      .number()
      .int({ message: "Số lượng phải là số nguyên." })
      .positive({ message: "Số lượng phải lớn hơn 0." }),
    manufacturedDate: z.string().date().nullable().optional(),
    expiryDate: z.string().date(),
    manufacturer: z.string().trim().max(300).nullable().optional(),
    qualityStatus: z.enum(["PendingQc", "Released", "Rejected"]).default("Released"),
    reason: z.string().trim().max(500).optional(),
  })
  .superRefine((value, context) => {
    if (!hasOneReference({ id: value.productId, code: value.productSku }))
      context.addIssue({
        code: "custom",
        path: ["productSku"],
        message: "Provide exactly one of productId or productSku",
      });
    if (!hasOneReference({ id: value.siteId, code: value.siteCode }))
      context.addIssue({ code: "custom", path: ["siteCode"], message: "Provide exactly one of siteId or siteCode" });
    if (!hasOneReference({ id: value.storageLocationId, code: value.storageLocationCode }))
      context.addIssue({
        code: "custom",
        path: ["storageLocationCode"],
        message: "Provide exactly one of storageLocationId or storageLocationCode",
      });
    if (value.supplierId && value.supplierCode)
      context.addIssue({
        code: "custom",
        path: ["supplierCode"],
        message: "Provide only one of supplierId or supplierCode",
      });
  });

export const openingBalanceImportSchema = z.object({
  schemaVersion: z.literal(importSchemaVersion),
  balances: z.array(openingBalanceImportRowSchema).min(1),
});

export type OpeningBalanceImport = z.infer<typeof openingBalanceImportSchema>;
export type OpeningBalanceImportRow = z.infer<typeof openingBalanceImportRowSchema>;

export type OpeningBalanceImportResult = {
  created: number;
  unchanged: number;
  batchesCreated: number;
  balances: Array<{
    productId: string;
    siteId: string;
    storageLocationId: string;
    batchNumber: string;
    quantity: number;
  }>;
};
