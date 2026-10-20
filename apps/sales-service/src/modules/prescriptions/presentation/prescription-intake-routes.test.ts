import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrescriptionExtraction } from "../../../contracts/prescription-intake.ts";
import { createLogger } from "../../../logger.ts";
import { createErrorHandler } from "../../../shared/presentation/error-handler.ts";
import {
  PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS,
  PrescriptionIntakeRateLimiterError,
  type PrescriptionIntakeRateLimiter,
} from "../domain/prescription-intake-rate-limiter.ts";
import { PrescriptionReaderError, type PrescriptionReader } from "../domain/prescription-reader.ts";
import { createPrescriptionIntakeRouter } from "./prescription-intake-routes.ts";

const httpFetch = globalThis.fetch.bind(globalThis);
const actorHeaders = { "x-actor-id": "00000000-0000-4000-8000-000000000001" };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const product = { id: "00000000-0000-4000-8000-000000000005", name: "PARACETAMOL 500MG" };

const extraction = (overrides: Partial<PrescriptionExtraction> = {}): PrescriptionExtraction => ({
  isPrescription: true,
  code: "a1b2c3d4e5f6-C",
  patientName: "Nguyễn Văn A",
  facilityName: "Phòng khám Đa khoa",
  doctorName: null,
  diagnosis: null,
  issuedOn: "05/10/2026",
  lines: [
    {
      rawText: "Paracetamol 500mg",
      name: "Paracetamol 500mg",
      activeIngredients: ["Paracetamol"],
      strength: "500 mg",
      dosageForm: null,
      quantity: 20,
      unit: "viên",
      usage: null,
    },
  ],
  ...overrides,
});

/** The burst window the route must honour; reading it here keeps this file in step when the limit changes. */
const minuteWindow = PRESCRIPTION_INTAKE_RATE_LIMIT_WINDOWS.find((window) => window.name === "minute");
if (!minuteWindow) throw new Error("prescription intake minute window is missing");
const minuteLimit = minuteWindow.limit;
const minuteSeconds = minuteWindow.seconds;

const createTestLimiter = () => {
  const attemptsByActor = new Map<string, number>();
  const consume = vi.fn<PrescriptionIntakeRateLimiter["consume"]>(async (actorId) => {
    const attempts = (attemptsByActor.get(actorId) ?? 0) + 1;
    attemptsByActor.set(actorId, attempts);
    if (attempts <= minuteLimit) return undefined;
    return minuteSeconds - (Math.floor(Date.now() / 1_000) % minuteSeconds);
  });
  const limiter: PrescriptionIntakeRateLimiter = { consume };
  return { limiter, consume };
};

/** Starts the intake router and stands in for the catalog; every other URL goes to the real network stack. */
const startServer = async (
  reader: Omit<PrescriptionReader, "isAvailable">,
  limiter: PrescriptionIntakeRateLimiter = createTestLimiter().limiter,
) => {
  // The intake route reads the shared internal secret before it calls the catalog for suggestions.
  vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
  const catalogBodies: unknown[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    if (input.toString().startsWith("http://catalog.test/products/match")) {
      const body = JSON.parse(init?.body as string) as { items: unknown[] };
      catalogBodies.push(body);
      return Response.json(
        body.items.map((_item, index) => ({
          matches: [
            {
              matchType: "name",
              strengthMatch: true,
              dosageFormMatch: null,
              ingredientsMatch: true,
              score: 1 - index / 10,
              product,
            },
          ],
        })),
      );
    }
    return httpFetch(input, init);
  });
  const app = express();
  app.use(express.json());
  app.use(
    createPrescriptionIntakeRouter({
      reader: { isAvailable: async () => true, ...reader },
      limiter,
      catalogServiceUrl: "http://catalog.test",
    }),
  );
  app.use(createErrorHandler(createLogger({ level: "silent" })));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}`, catalogBodies };
};

/** Stands in for a reader a shopper cannot reach because no Gemini key is stored yet. */
const noKeyReader = () => {
  const read = vi.fn<PrescriptionReader["read"]>().mockRejectedValue(new Error("reader must not be reached"));
  const reader: PrescriptionReader = { isAvailable: async () => false, read };
  return { reader, read };
};

describe("prescription intake API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const postImage = (
    url: string,
    body: Buffer,
    contentType = "image/jpeg",
    headers: Record<string, string> = actorHeaders,
  ) =>
    httpFetch(`${url}/prescriptions/intake/image`, {
      method: "POST",
      headers: { "content-type": contentType, ...headers },
      body,
    });

  it("pairs each medicine read from a photo with its suggestions", async () => {
    const read = vi.fn<PrescriptionReader["read"]>().mockResolvedValue(
      extraction({
        lines: [
          ...extraction().lines,
          {
            ...extraction().lines[0]!,
            rawText: "Vitamin C 500mg",
            name: "Vitamin C 500mg",
            activeIngredients: ["Acid ascorbic"],
          },
        ],
      }),
    );
    const started = await startServer({ read });
    server = started.server;

    const response = await postImage(started.url, jpeg);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      source: string;
      prescription: Record<string, unknown>;
      lines: Array<{ extracted: { rawText: string }; matches: Array<{ score: number }> }>;
    };
    expect(read).toHaveBeenCalledWith(jpeg, "image/jpeg");
    expect(body.source).toBe("image");
    expect(body.prescription).toMatchObject({
      code: "a1b2c3d4e5f6-C",
      patientName: "Nguyễn Văn A",
      issuedOn: "05/10/2026",
    });
    expect(body.prescription).not.toHaveProperty("isPrescription");
    expect(body.lines.map((line) => line.extracted.rawText)).toEqual(["Paracetamol 500mg", "Vitamin C 500mg"]);
    expect(body.lines.map((line) => line.matches[0]?.score)).toEqual([1, 0.9]);
    expect(started.catalogBodies).toEqual([
      {
        items: [
          {
            name: "Paracetamol 500mg",
            activeIngredients: ["Paracetamol"],
            strength: "500 mg",
            dosageForm: null,
            unit: "viên",
          },
          {
            name: "Vitamin C 500mg",
            activeIngredients: ["Acid ascorbic"],
            strength: "500 mg",
            dosageForm: null,
            unit: "viên",
          },
        ],
        limit: 5,
      },
    ]);
  });

  it("answers 422 when the photo is not a prescription or has no readable medicine", async () => {
    const read = vi
      .fn<PrescriptionReader["read"]>()
      .mockResolvedValueOnce(extraction({ isPrescription: false, lines: [] }))
      .mockResolvedValueOnce(extraction({ lines: [] }));
    const started = await startServer({ read });
    server = started.server;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await postImage(started.url, jpeg);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "not_a_prescription" });
    }
    expect(started.catalogBodies).toHaveLength(0);
  });

  it("separates an unreadable answer (422) from a provider outage (502)", async () => {
    const read = vi
      .fn<PrescriptionReader["read"]>()
      .mockRejectedValueOnce(new PrescriptionReaderError("unreadable", "bad json"))
      .mockRejectedValueOnce(new PrescriptionReaderError("unavailable", "HTTP 429"));
    const started = await startServer({ read });
    server = started.server;

    const unreadable = await postImage(started.url, jpeg);
    const outage = await postImage(started.url, jpeg);

    expect(unreadable.status).toBe(422);
    expect(await unreadable.json()).toMatchObject({ code: "unreadable_prescription" });
    expect(outage.status).toBe(502);
    expect(await outage.json()).toMatchObject({ code: "reader_failed" });
  });

  it("rejects bytes that do not match the declared image type before calling the provider", async () => {
    const read = vi.fn<PrescriptionReader["read"]>();
    const started = await startServer({ read });
    server = started.server;

    const mismatch = await postImage(started.url, Buffer.from("%PDF-1.7"), "image/jpeg");
    const wrongType = await postImage(started.url, jpeg, "application/pdf");

    expect(mismatch.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it("requires a signed-in shopper", async () => {
    const read = vi.fn<PrescriptionReader["read"]>();
    const started = await startServer({ read });
    server = started.server;

    const photo = await postImage(started.url, jpeg, "image/jpeg", {});
    const qr = await httpFetch(`${started.url}/prescriptions/intake/qr`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "{}" }),
    });

    expect(photo.status).toBe(401);
    expect(qr.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps QR intake working when photo reading is not configured", async () => {
    const started = await startServer(noKeyReader().reader);
    server = started.server;

    const photo = await postImage(started.url, jpeg);
    const qr = await httpFetch(`${started.url}/prescriptions/intake/qr`, {
      method: "POST",
      headers: { "content-type": "application/json", ...actorHeaders },
      body: JSON.stringify({
        payload: JSON.stringify({
          ma_don_thuoc: "a1b2c3d4e5f6-C",
          thong_tin_don_thuoc: [
            {
              biet_duoc: "Amoxicillin + Acid clavulanic",
              ten_thuoc: "Augmentin 625mg",
              don_vi_tinh: "viên",
              so_luong: 14,
              cach_dung: "Sáng 1, tối 1",
            },
          ],
        }),
      }),
    });

    expect(photo.status).toBe(503);
    expect(qr.status).toBe(200);
    expect(await qr.json()).toMatchObject({
      source: "qr",
      prescription: { code: "a1b2c3d4e5f6-C" },
      lines: [
        {
          extracted: {
            name: "Augmentin 625mg",
            activeIngredients: ["Amoxicillin", "Acid clavulanic"],
            strength: "625mg",
            quantity: 14,
            unit: "viên",
            usage: "Sáng 1, tối 1",
          },
        },
      ],
    });
  });

  it("rejects a QR that is not an e-prescription", async () => {
    const started = await startServer(noKeyReader().reader);
    server = started.server;

    for (const payload of ["https://example.com", JSON.stringify({ ma_don_thuoc: "bad", thong_tin_don_thuoc: [] })]) {
      const response = await httpFetch(`${started.url}/prescriptions/intake/qr`, {
        method: "POST",
        headers: { "content-type": "application/json", ...actorHeaders },
        body: JSON.stringify({ payload }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_qr" });
    }
  });

  it("reports a catalog outage instead of an empty suggestion list", async () => {
    const read = vi.fn<PrescriptionReader["read"]>().mockResolvedValue(extraction());
    const started = await startServer({ read });
    server = started.server;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) =>
      input.toString().startsWith("http://catalog.test")
        ? new Response("down", { status: 503 })
        : httpFetch(input, init),
    );

    const response = await postImage(started.url, jpeg);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "catalog_unavailable" });
  });

  it("stops a shopper at the burst limit and leaves other shoppers unaffected", async () => {
    const read = vi.fn<PrescriptionReader["read"]>().mockResolvedValue(extraction());
    const { limiter, consume } = createTestLimiter();
    const started = await startServer({ read }, limiter);
    server = started.server;

    for (let attempt = 0; attempt < minuteLimit; attempt += 1) {
      expect((await postImage(started.url, jpeg)).status).toBe(200);
    }

    const limited = await postImage(started.url, jpeg);

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ title: "Too many requests", status: 429, code: "rate_limited" });
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(minuteSeconds);
    expect(read).toHaveBeenCalledTimes(minuteLimit);

    const otherShopper = await postImage(started.url, jpeg, "image/jpeg", {
      "x-actor-id": "00000000-0000-4000-8000-000000000002",
    });

    expect(otherShopper.status).toBe(200);
    expect(consume).toHaveBeenCalledTimes(minuteLimit + 2);
  });

  it("does not spend an intake allowance on a QR prescription", async () => {
    const read = vi.fn<PrescriptionReader["read"]>().mockResolvedValue(extraction());
    const { limiter, consume } = createTestLimiter();
    const started = await startServer({ read }, limiter);
    server = started.server;

    const qr = await httpFetch(`${started.url}/prescriptions/intake/qr`, {
      method: "POST",
      headers: { "content-type": "application/json", ...actorHeaders },
      body: JSON.stringify({
        payload: JSON.stringify({
          ma_don_thuoc: "a1b2c3d4e5f6-C",
          thong_tin_don_thuoc: [
            {
              biet_duoc: "Paracetamol",
              ten_thuoc: "Paracetamol 500mg",
              don_vi_tinh: "viên",
              so_luong: 20,
              cach_dung: "Sáng 1, tối 1",
            },
          ],
        }),
      }),
    });

    expect(qr.status).toBe(200);
    expect(consume).not.toHaveBeenCalled();
  });

  it("does not spend an intake allowance on a photo when no key is stored", async () => {
    const { reader, read } = noKeyReader();
    const { limiter, consume } = createTestLimiter();
    const started = await startServer(reader, limiter);
    server = started.server;

    const response = await postImage(started.url, jpeg);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "reader_unavailable" });
    expect(consume).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses the photo when the limiter cannot count, without calling the reader", async () => {
    const read = vi.fn<PrescriptionReader["read"]>().mockResolvedValue(extraction());
    const limiter: PrescriptionIntakeRateLimiter = {
      consume: vi
        .fn<PrescriptionIntakeRateLimiter["consume"]>()
        .mockRejectedValue(new PrescriptionIntakeRateLimiterError("store is down")),
    };
    const started = await startServer({ read }, limiter);
    server = started.server;

    const response = await postImage(started.url, jpeg);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      title: "Rate limiter unavailable",
      status: 503,
      code: "rate_limit_unavailable",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("answers 413 instead of 500 for a photo over the route body limit", async () => {
    const read = vi.fn<PrescriptionReader["read"]>().mockResolvedValue(extraction());
    const started = await startServer({ read });
    server = started.server;

    const response = await postImage(started.url, Buffer.alloc(9 * 1024 * 1024));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ title: "Payload too large", status: 413 });
    expect(read).not.toHaveBeenCalled();
  });
});
