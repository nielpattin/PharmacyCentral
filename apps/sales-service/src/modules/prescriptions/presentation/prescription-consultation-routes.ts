import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";

import {
  answerPrescriptionConsultationRequestSchema,
  createPrescriptionConsultationRequestSchema,
  prescriptionConsultationStatuses,
} from "../../../contracts/prescription-consultation.ts";
import { internalServiceHeaders } from "../../../internal-service-headers.ts";
import { actorSiteIds, listSiteIds } from "../../../middleware/trusted-request.ts";
import { readCursorParam } from "../../../shared/page-cursor.ts";
import { invalidCursor, sendPage } from "../../../shared/presentation/page-response.ts";
import { sendDatabaseUnavailable as unavailable } from "../../../shared/presentation/database-unavailable.ts";
import type { PrescriptionConsultationRepository } from "../infrastructure/prescription-consultation-repository.ts";

const idSchema = z.object({ id: z.string().uuid() });
/**
 * `siteId` is only read for staff and internal callers; a shopper's own rows are never narrowed by site, so their
 * query is parsed without it. `q` matches the patient's name and the prescription code, as stored in the consultation.
 */
const listQuerySchema = z.object({
  status: z.enum(prescriptionConsultationStatuses).optional(),
  siteId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
});

const problem = (response: Response, status: number, code: string, title: string, detail: string) =>
  response.status(status).json({ title, status, code, detail });

const UNAUTHENTICATED = { title: "Authentication required", status: 401, code: "unauthenticated" };

const INVALID_REQUEST = {
  title: "Invalid consultation request",
  status: 400,
  code: "invalid_request",
  detail: "Yêu cầu nhờ dược sĩ tư vấn không hợp lệ.",
};

const INVALID_SITE = {
  title: "Invalid store",
  status: 400,
  code: "invalid_site",
  detail: "Cơ sở đã chọn không tồn tại hoặc không nhận khách hàng.",
};

const CATALOG_UNAVAILABLE = {
  title: "Catalog service is unavailable",
  status: 503,
  code: "catalog_unavailable",
  detail: "Không kiểm tra được cơ sở đã chọn, vui lòng thử lại.",
};

type SiteCheck = "valid" | "invalid" | "unavailable";

/**
 * The shopper picks the store on the intake page, so the id has to name a store the pharmacy offers to customers:
 * an unknown id, a closed store or a warehouse would file the request against somewhere no pharmacist works the
 * shop counter. A catalog that cannot answer is not a verdict on the store, so it fails closed with a 503.
 */
const verifyCustomerFacingSite = async (siteId: string, catalogServiceUrl: string): Promise<SiteCheck> => {
  try {
    const response = await fetch(`${catalogServiceUrl}/sites/${siteId}`, {
      headers: internalServiceHeaders(),
      signal: AbortSignal.timeout(2_000),
    });
    if (response.status === 404) return "invalid";
    if (!response.ok) return "unavailable";
    const site = (await response.json()) as { isActive?: boolean; isCustomerFacing?: boolean };
    return site.isActive === true && site.isCustomerFacing === true ? "valid" : "invalid";
  } catch {
    return "unavailable";
  }
};

export type PrescriptionConsultationRouterOptions = {
  /** Validated at boot by main.ts; the create route resolves the shopper's chosen store through it. */
  catalogServiceUrl: string;
};

/**
 * Prescription consultations: a shopper whose prescription cannot be filled as prescribed at their store sends the
 * whole thing to the pharmacists, who answer it in writing. The prescription tables cannot hold this, because a
 * consultation names no product, unit, site or storage location and reserves no stock.
 */
export const createPrescriptionConsultationRouter = (
  repository: PrescriptionConsultationRepository | undefined,
  options: PrescriptionConsultationRouterOptions,
): Router => {
  const router = Router();

  router.post("/prescriptions/consultations", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = request.header("X-Actor-Id");
    if (!customerId) return response.status(401).json(UNAUTHENTICATED);
    // Only the shopper has a prescription to ask about; a staff account posting one would leave the asker unknown.
    if (request.header("X-Actor-Type") !== "customer")
      return problem(
        response,
        403,
        "customers_only",
        "Customers only",
        "Chỉ tài khoản khách hàng mới gửi được yêu cầu nhờ dược sĩ tư vấn.",
      );
    const parsed = createPrescriptionConsultationRequestSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json(INVALID_REQUEST);
    if (parsed.data.siteId) {
      const siteCheck = await verifyCustomerFacingSite(parsed.data.siteId, options.catalogServiceUrl);
      if (siteCheck === "invalid") return response.status(400).json(INVALID_SITE);
      if (siteCheck === "unavailable") return response.status(503).json(CATALOG_UNAVAILABLE);
    }
    try {
      const idempotencyKey = request.header("Idempotency-Key") ?? undefined;
      const { consultation } = await repository.create({
        customerId,
        siteId: parsed.data.siteId,
        source: parsed.data.source,
        prescription: parsed.data.prescription,
        lines: parsed.data.lines,
        note: parsed.data.note,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return response.status(201).json(consultation);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/prescriptions/consultations", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const requesterId = request.header("X-Actor-Id");
    if (!requesterId) return response.status(401).json(UNAUTHENTICATED);
    // Pharmacy staff and internal services read every consultation; a shopper only ever sees their own rows.
    const actorType = request.header("X-Actor-Type");
    const staff = actorType === "employee" || actorType === "system";
    const query = listQuerySchema.safeParse(
      staff ? request.query : { status: request.query.status, limit: request.query.limit, q: request.query.q },
    );
    if (!query.success) return response.status(400).json(INVALID_REQUEST);
    const cursor = readCursorParam(request.query.cursor);
    if (!cursor.ok) return invalidCursor(response);
    try {
      // The owner filter is never optional for a shopper, and their site filter is ignored rather than honoured.
      const page = await repository.list({
        ...(staff ? {} : { customerId: requesterId }),
        ...(staff ? { siteIds: listSiteIds(request) } : {}),
        ...(query.data.status ? { status: query.data.status } : {}),
        limit: query.data.limit,
        ...(query.data.q ? { q: query.data.q } : {}),
        ...(cursor.cursor ? { after: cursor.cursor } : {}),
      });
      return sendPage(response, page);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/prescriptions/consultations/:id/answer", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const answeredBy = request.header("X-Actor-Id");
    if (!answeredBy) return response.status(401).json(UNAUTHENTICATED);
    if (request.header("X-Actor-Type") !== "employee")
      return problem(
        response,
        403,
        "staff_only",
        "Pharmacy staff only",
        "Chỉ dược sĩ mới trả lời được yêu cầu tư vấn.",
      );
    const id = idSchema.safeParse(request.params);
    const parsed = answerPrescriptionConsultationRequestSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return response.status(400).json(INVALID_REQUEST);
    try {
      // The scope comes from the verified context, not from the request: a pharmacist assigned to one site answers
      // that site's queue and the unassigned requests, never another pharmacy's.
      const result = await repository.answer(id.data.id, parsed.data.reply, answeredBy, actorSiteIds(request));
      if (result.kind === "not_found")
        return problem(
          response,
          404,
          "consultation_not_found",
          "Consultation not found",
          "Không tìm thấy yêu cầu tư vấn này.",
        );
      if (result.kind === "already_answered")
        return problem(
          response,
          409,
          "consultation_already_answered",
          "Consultation already answered",
          "Yêu cầu tư vấn này đã được trả lời.",
        );
      return response.json(result.consultation);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};
