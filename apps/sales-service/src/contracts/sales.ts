import { z } from "zod";

export const salesContractVersion = "v1" as const;

export const orderChangedEventSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(["pending", "confirmed", "preparing", "ready", "delivering", "completed", "cancelled"]),
});

export const cartLineSchema = z.object({
  productId: z.string().uuid(),
  productUnitId: z.string().uuid(),
  quantity: z.number().positive(),
});

/** The signed-out cart handed over once at sign-in. A line keeps the tick the shopper set in the browser. */
export const mergeCartRequestSchema = z.object({
  lines: z
    .array(cartLineSchema.extend({ selected: z.boolean() }))
    .min(1)
    .max(200),
});

export const deliveryPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const deliveryCalculateRequestSchema = z.object({
  destination: deliveryPointSchema,
  selectedStoreId: z.string().uuid(),
  addressNote: z.string().trim().max(500).optional(),
});

export const routeGeoJsonSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
});

export const deliveryCalculateResponseSchema = z.object({
  selectedStoreId: z.string().uuid(),
  origin: deliveryPointSchema,
  destination: deliveryPointSchema,
  providerResolvedAddress: z.string(),
  addressNote: z.string().nullable(),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  fee: z.number().nonnegative(),
  currency: z.string().length(3),
  route: routeGeoJsonSchema,
});

export const reverseGeocodeRequestSchema = z.object({
  destination: deliveryPointSchema,
});

export const reverseGeocodeResponseSchema = z.object({
  destination: deliveryPointSchema,
  providerResolvedAddress: z.string(),
});

/**
 * Address search is proxied rather than called from the browser because the Vietmap service key is a paid
 * metered credential: shipping it in a Vite bundle would let any visitor spend the account's 60,000 monthly
 * transactions. The browser sends plain text and gets back display strings plus opaque handles, never the key.
 */
export const addressSearchQuerySchema = z.object({
  /** Vietmap matches on short prefixes too eagerly, so the caller only asks once this many characters exist. */
  q: z.string().trim().min(2).max(200),
});

export const addressSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      refId: z.string().min(1),
      displayName: z.string().min(1),
    }),
  ),
});

export const addressResolveRequestSchema = z.object({
  refId: z.string().min(1).max(500),
});

export const addressResolveResponseSchema = z.object({
  refId: z.string().min(1),
  displayName: z.string().min(1),
  destination: deliveryPointSchema,
});

export type AddressSearchQuery = z.infer<typeof addressSearchQuerySchema>;
export type AddressSearchResponse = z.infer<typeof addressSearchResponseSchema>;
export type AddressResolveResponse = z.infer<typeof addressResolveResponseSchema>;

export const orderLineSchema = z.object({
  productId: z.string().uuid(),
  productUnitId: z.string().uuid(),
  productNameSnapshot: z.string().trim().min(1).max(300),
  unitPriceSnapshot: z.number().positive(),
  quantity: z.number().positive(),
});

export const deliverySnapshotSchema = z.object({
  originLatitude: z.number().min(-90).max(90),
  originLongitude: z.number().min(-180).max(180),
  destinationLatitude: z.number().min(-90).max(90),
  destinationLongitude: z.number().min(-180).max(180),
  providerResolvedAddress: z.string().trim().min(1).max(2000),
  addressNote: z.string().trim().max(500).nullable(),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  routeGeoJson: routeGeoJsonSchema,
});

export const createOrderRequestSchema = z
  .object({
    selectedStoreId: z.string().uuid(),
    fulfillmentType: z.enum(["pickup", "delivery"]),
    /** How the shopper means to pay; it sets how long an unpaid order holds its stock. */
    paymentMethod: z.enum(["sepay_qr", "cash_on_delivery"]).optional(),
    /** The lines to order, named by the caller. Send either this or `fromCart`, never both. */
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          productUnitId: z.string().uuid(),
          quantity: z.number().positive(),
        }),
      )
      .min(1)
      .optional(),
    /** Order the caller's ticked cart lines: the server reads them from the cart and removes them once ordered. */
    fromCart: z.literal(true).optional(),
    delivery: z
      .object({
        destination: deliveryPointSchema,
        addressNote: z.string().trim().max(500).optional(),
      })
      .optional(),
  })
  .refine((order) => (order.lines === undefined) !== (order.fromCart === undefined), {
    message: "Send either lines or fromCart: true",
    path: ["lines"],
  });

export const orderTransitionSchema = z.object({
  status: z.enum(["Confirmed", "Preparing", "Ready", "Delivering", "Completed", "Cancelled"]),
});

export const prescriptionLineSchema = z.object({
  productId: z.string().uuid(),
  productUnitId: z.string().uuid(),
  prescribedQuantity: z.number().positive(),
  dosage: z.string().trim().max(500).nullable().optional(),
  frequency: z.string().trim().max(200).nullable().optional(),
  duration: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const createPrescriptionRequestSchema = z.object({
  siteId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  patientName: z.string().trim().min(1).max(200),
  patientPhone: z.string().trim().max(50).nullable().optional(),
  doctorName: z.string().trim().max(200).nullable().optional(),
  doctorLicense: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  // Staff link a prescription to the shopper's account so the customer can read it; walk-in patients stay unlinked.
  customerId: z.string().uuid().nullable().optional(),
  lines: z.array(prescriptionLineSchema).min(1),
});

export const dispensePrescriptionRequestSchema = z.object({
  lines: z
    .array(
      z.object({
        prescriptionLineId: z.string().uuid(),
        productBatchId: z.string().uuid(),
        dispensedQuantity: z.number().positive(),
      }),
    )
    .min(1),
});

/** The period of `GET /internal/analytics/sales-documents`: `from` inclusive, `to` exclusive. */
export const salesDocumentsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

/** An online order (`order`, `siteId` the selected store) or a counter prescription (`prescription`). */
export const salesDocumentSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["order", "prescription"]),
  siteId: z.string().uuid(),
  /** The customer who bought: always set for an online order, optional for a counter prescription. */
  customerId: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

export const salesDocumentsResponseSchema = z.object({ documents: z.array(salesDocumentSchema) });

/**
 * A customer who bought in the period and the first payment ever seen for them. It is the new-versus-returning split
 * of `GET /internal/analytics/customer-first-paid`: a date inside the period is a new customer, an earlier date a
 * returning one. Refunds keep the date, because the first purchase still happened.
 */
export const customerFirstPaidSchema = z.object({
  customerId: z.string().uuid(),
  firstPaidAt: z.string().datetime({ offset: true }),
});

export const customerFirstPaidResponseSchema = z.object({ customers: z.array(customerFirstPaidSchema) });

export type CustomerFirstPaid = z.infer<typeof customerFirstPaidSchema>;

/** A calendar month as the target API takes it: `YYYY-MM`. */
export const salesTargetMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** `PUT /sales-targets`: one site's revenue goal for a month; writing the same pair again replaces the amount. */
export const setSalesTargetSchema = z.object({
  siteId: z.string().uuid(),
  month: salesTargetMonthSchema,
  amount: z.number().positive().max(1_000_000_000_000),
});

export const salesTargetSchema = z.object({
  siteId: z.string().uuid(),
  month: salesTargetMonthSchema,
  amount: z.number().nonnegative(),
  currency: z.string(),
});

export const salesTargetsResponseSchema = z.object({ targets: z.array(salesTargetSchema) });

export type SetSalesTarget = z.infer<typeof setSalesTargetSchema>;
export type SalesTarget = z.infer<typeof salesTargetSchema>;

export type OrderChangedEvent = z.infer<typeof orderChangedEventSchema>;
export type CartLine = z.infer<typeof cartLineSchema>;
export type DeliveryPoint = z.infer<typeof deliveryPointSchema>;
export type DeliveryCalculateRequest = z.infer<typeof deliveryCalculateRequestSchema>;
export type RouteGeoJson = z.infer<typeof routeGeoJsonSchema>;
export type DeliveryCalculateResponse = z.infer<typeof deliveryCalculateResponseSchema>;
export type OrderLine = z.infer<typeof orderLineSchema>;
export type DeliverySnapshot = z.infer<typeof deliverySnapshotSchema>;
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type OrderTransition = z.infer<typeof orderTransitionSchema>;
export type PrescriptionLine = z.infer<typeof prescriptionLineSchema>;
export type CreatePrescriptionRequest = z.infer<typeof createPrescriptionRequestSchema>;
export type DispensePrescriptionRequest = z.infer<typeof dispensePrescriptionRequestSchema>;
export type SalesDocument = z.infer<typeof salesDocumentSchema>;
export type SalesDocumentsResponse = z.infer<typeof salesDocumentsResponseSchema>;
