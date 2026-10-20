import express, { Router } from "express";
import type { Response } from "express";

import {
  prescriptionQrRequestSchema,
  type ExtractedLine,
  type IntakeMatch,
  type IntakePrescription,
  type PrescriptionIntakeResult,
} from "../../../contracts/prescription-intake.ts";
import { internalServiceHeaders } from "../../../internal-service-headers.ts";
import {
  PrescriptionIntakeRateLimiterError,
  type PrescriptionIntakeRateLimiter,
} from "../domain/prescription-intake-rate-limiter.ts";
import {
  IMAGE_MIME_TYPES,
  PrescriptionReaderError,
  isImageOfType,
  type ImageMimeType,
  type PrescriptionReader,
} from "../domain/prescription-reader.ts";
import { linesFromQr, parsePrescriptionQr } from "../domain/prescription-qr.ts";

export type PrescriptionIntakeOptions = {
  reader: PrescriptionReader;
  /** Counts every photo intake, and refuses the request when it cannot count. QR intake never consults it. */
  limiter: PrescriptionIntakeRateLimiter;
  catalogServiceUrl: string;
};

/** Suggestions shown per prescription line. */
const MATCHES_PER_LINE = 5;
/** The browser downscales photos before upload; this only stops an unbounded body. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const problem = (response: Response, status: number, code: string, title: string, detail: string) =>
  response.status(status).json({ title, status, code, detail });

const UNAUTHENTICATED = { title: "Authentication required", status: 401, code: "unauthenticated" };

/** Asks the catalog for the products closest to each prescription line; the answer is in request order. */
const matchLines = async (
  lines: ExtractedLine[],
  catalogServiceUrl: string,
): Promise<Array<{ matches: IntakeMatch[] }>> => {
  const upstream = await fetch(`${catalogServiceUrl}/products/match`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalServiceHeaders() },
    body: JSON.stringify({
      items: lines.map((line) => ({
        name: line.name,
        activeIngredients: line.activeIngredients,
        strength: line.strength,
        dosageForm: line.dosageForm,
        unit: line.unit,
      })),
      limit: MATCHES_PER_LINE,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!upstream.ok) throw new Error(`Catalog product match answered HTTP ${upstream.status}`);
  return (await upstream.json()) as Array<{ matches: IntakeMatch[] }>;
};

/**
 * Prescription intake: a shopper's printed prescription, as a photo or as the text of its QR, becomes the catalog
 * products that could fill it. Nothing is stored and nothing is added to a cart here; the shopper reviews the
 * suggestions first, because a wrong guess about a medicine must never be silent.
 */
export const createPrescriptionIntakeRouter = (options: PrescriptionIntakeOptions): Router => {
  const router = Router();

  const respond = async (
    response: Response,
    source: PrescriptionIntakeResult["source"],
    prescription: IntakePrescription,
    lines: ExtractedLine[],
  ) => {
    let matched: Array<{ matches: IntakeMatch[] }>;
    try {
      matched = await matchLines(lines, options.catalogServiceUrl);
    } catch {
      return problem(
        response,
        502,
        "catalog_unavailable",
        "Catalog unavailable",
        "Chưa tra được thuốc trong danh mục. Vui lòng thử lại sau.",
      );
    }
    const result: PrescriptionIntakeResult = {
      source,
      prescription,
      lines: lines.map((extracted, index) => ({ extracted, matches: matched[index]?.matches ?? [] })),
    };
    return response.json(result);
  };

  // A shopper's prescription is personal data and a Gemini call costs money, so intake is for signed-in users only.
  router.use("/prescriptions/intake", (request, response, next) => {
    if (request.header("X-Actor-Id")) return next();
    return response.status(401).json(UNAUTHENTICATED);
  });

  router.post(
    "/prescriptions/intake/image",
    express.raw({ type: [...IMAGE_MIME_TYPES], limit: MAX_IMAGE_BYTES }),
    async (request, response) => {
      if (!(await options.reader.isAvailable())) {
        return problem(
          response,
          503,
          "reader_unavailable",
          "Prescription reader is not configured",
          "Tính năng đọc đơn thuốc từ ảnh chưa được bật.",
        );
      }
      const mimeType = request.header("content-type")?.split(";")[0]?.trim() as ImageMimeType | undefined;
      const image: unknown = request.body;
      if (
        !mimeType ||
        !IMAGE_MIME_TYPES.includes(mimeType) ||
        !Buffer.isBuffer(image) ||
        image.length === 0 ||
        !isImageOfType(image, mimeType)
      ) {
        return problem(
          response,
          400,
          "invalid_image",
          "Invalid prescription image",
          "Chỉ nhận ảnh JPEG, PNG hoặc WebP.",
        );
      }

      // The guard above refuses a request without an actor; reading it again is what makes the id a string here.
      const actorId = request.header("X-Actor-Id");
      if (!actorId) return response.status(401).json(UNAUTHENTICATED);

      // The meter counts only a photo that could reach the reader, so a malformed upload costs no allowance.
      let retryAfterSeconds: number | undefined;
      try {
        retryAfterSeconds = await options.limiter.consume(actorId);
      } catch (error) {
        if (!(error instanceof PrescriptionIntakeRateLimiterError)) throw error;
        // A meter that cannot count cannot be allowed to let a metered reader call through.
        return problem(
          response,
          503,
          "rate_limit_unavailable",
          "Rate limiter unavailable",
          "Tạm thời chưa kiểm soát được lượt đọc đơn thuốc. Vui lòng thử lại sau.",
        );
      }
      if (retryAfterSeconds !== undefined) {
        response.setHeader("Retry-After", String(retryAfterSeconds));
        return problem(
          response,
          429,
          "rate_limited",
          "Too many requests",
          "Bạn đã gửi quá nhiều ảnh đơn thuốc. Vui lòng thử lại sau.",
        );
      }

      let extraction;
      try {
        extraction = await options.reader.read(image, mimeType);
      } catch (error) {
        if (!(error instanceof PrescriptionReaderError)) throw error;
        if (error.kind === "unreadable") {
          return problem(
            response,
            422,
            "unreadable_prescription",
            "Prescription could not be read",
            "Không đọc được đơn thuốc từ ảnh này. Hãy chụp lại rõ nét, đủ sáng và thấy toàn bộ đơn.",
          );
        }
        return problem(
          response,
          502,
          "reader_failed",
          "Prescription reader failed",
          "Dịch vụ đọc đơn thuốc đang bận. Vui lòng thử lại sau ít phút.",
        );
      }
      if (!extraction.isPrescription || extraction.lines.length === 0) {
        return problem(
          response,
          422,
          "not_a_prescription",
          "Image is not a prescription",
          "Ảnh này không giống một đơn thuốc in hoặc không có thuốc nào đọc được. Hãy chụp lại rõ nét, đủ sáng.",
        );
      }
      const { isPrescription: _isPrescription, lines, ...prescription } = extraction;
      return respond(response, "image", prescription, lines);
    },
  );

  router.post("/prescriptions/intake/qr", async (request, response) => {
    const body = prescriptionQrRequestSchema.safeParse(request.body);
    const payload = body.success ? parsePrescriptionQr(body.data.payload) : undefined;
    if (!payload) {
      return problem(
        response,
        400,
        "invalid_qr",
        "Invalid prescription QR",
        "Mã QR này không phải mã đơn thuốc hợp lệ.",
      );
    }
    return respond(
      response,
      "qr",
      {
        code: payload.ma_don_thuoc,
        patientName: null,
        facilityName: null,
        doctorName: null,
        diagnosis: null,
        issuedOn: null,
      },
      linesFromQr(payload),
    );
  });

  return router;
};
