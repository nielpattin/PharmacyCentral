import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { PrescriptionConsultation } from "../../../contracts/prescription-consultation.ts";
import { createLogger } from "../../../logger.ts";
import { encodeCursor } from "../../../shared/page-cursor.ts";
import { createErrorHandler } from "../../../shared/presentation/error-handler.ts";
import type { PrescriptionConsultationRepository } from "../infrastructure/prescription-consultation-repository.ts";
import { createPrescriptionConsultationRouter } from "./prescription-consultation-routes.ts";

const httpFetch = globalThis.fetch.bind(globalThis);
const ids = {
  customer: "00000000-0000-4000-8000-000000000001",
  consultation: "00000000-0000-4000-8000-000000000003",
  pharmacist: "00000000-0000-4000-8000-000000000004",
  other: "00000000-0000-4000-8000-0000000000fe",
  unknown: "00000000-0000-4000-8000-0000000000ff",
  site: "00000000-0000-4000-8000-000000000005",
};

const shopperHeaders = { "content-type": "application/json", "X-Actor-Id": ids.customer, "X-Actor-Type": "customer" };
const pharmacistHeaders = {
  "content-type": "application/json",
  "X-Actor-Id": ids.pharmacist,
  "X-Actor-Type": "employee",
};

const consultation = (overrides: Partial<PrescriptionConsultation> = {}): PrescriptionConsultation => ({
  id: ids.consultation,
  customerId: ids.customer,
  siteId: ids.site,
  source: "image",
  prescription: {
    code: null,
    patientName: "Nguyễn Văn A",
    facilityName: null,
    doctorName: null,
    diagnosis: null,
    issuedOn: null,
  },
  lines: [
    {
      rawText: "Augmentin 625mg",
      name: "Augmentin 625mg",
      activeIngredients: ["Amoxicillin"],
      strength: "625 mg",
      dosageForm: null,
      quantity: 20,
      unit: "viên",
      usage: null,
      needsHelp: true,
    },
  ],
  note: "Nhờ dược sĩ tìm giúp",
  status: "Open",
  reply: null,
  answeredBy: null,
  answeredAt: null,
  createdAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-08T08:00:00.000Z",
  ...overrides,
});

const createBody = () => ({
  source: "image",
  siteId: ids.site,
  prescription: consultation().prescription,
  lines: consultation().lines,
  note: "Nhờ dược sĩ tìm giúp",
});

type ConsultationRepositoryMock = {
  create: Mock<PrescriptionConsultationRepository["create"]>;
  list: Mock<PrescriptionConsultationRepository["list"]>;
  answer: Mock<PrescriptionConsultationRepository["answer"]>;
};

const createRepository = (): ConsultationRepositoryMock => ({
  create: vi.fn<PrescriptionConsultationRepository["create"]>(),
  list: vi.fn<PrescriptionConsultationRepository["list"]>(),
  answer: vi.fn<PrescriptionConsultationRepository["answer"]>(),
});

const createTestServer = async (
  repository: ConsultationRepositoryMock | undefined,
): Promise<{ server: Server; url: string }> => {
  // The create route reads the shared internal secret and resolves the shopper's store through the catalog, so a
  // valid customer-facing site answers by default; a test that needs another answer stubs `fetch` again.
  vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ id: ids.site, isActive: true, isCustomerFacing: true })),
  );
  const app = express();
  app.use(express.json());
  app.use(
    createPrescriptionConsultationRouter(repository as unknown as PrescriptionConsultationRepository | undefined, {
      catalogServiceUrl: "http://catalog.test",
    }),
  );
  app.use(createErrorHandler(createLogger({ level: "silent" })));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
};

describe("prescription consultation API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("takes a shopper's whole prescription and answers 201", async () => {
    const repository = createRepository();
    repository.create.mockResolvedValue({ consultation: consultation(), replayed: false });
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify(createBody()),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as PrescriptionConsultation;
    expect(body.id).toBe(ids.consultation);
    expect(body.status).toBe("Open");
    expect(repository.create.mock.calls[0]?.[0]).toEqual({
      customerId: ids.customer,
      siteId: ids.site,
      source: "image",
      prescription: consultation().prescription,
      lines: consultation().lines,
      note: "Nhờ dược sĩ tìm giúp",
    });
  });

  it("replays an idempotent consultation creation with the stored consultation", async () => {
    const repository = createRepository();
    repository.create.mockResolvedValue({ consultation: consultation(), replayed: true });
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: { ...shopperHeaders, "Idempotency-Key": "consultation-create-key" },
      body: JSON.stringify(createBody()),
    });

    expect(response.status).toBe(201);
    expect((await response.json()) as PrescriptionConsultation).toEqual(consultation());
    expect(repository.create.mock.calls[0]?.[0].idempotencyKey).toBe("consultation-create-key");
  });

  it("refuses a consultation from anyone who is not the shopper", async () => {
    const repository = createRepository();
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: pharmacistHeaders,
      body: JSON.stringify(createBody()),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "customers_only", status: 403 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("requires an actor to create and to list consultations", async () => {
    const repository = createRepository();
    const started = await createTestServer(repository);
    server = started.server;

    const createResponse = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Type": "customer" },
      body: JSON.stringify(createBody()),
    });
    expect(createResponse.status).toBe(401);
    expect(await createResponse.json()).toMatchObject({ code: "unauthenticated", status: 401 });

    const listResponse = await httpFetch(`${started.url}/prescriptions/consultations`);
    expect(listResponse.status).toBe(401);
    expect(await listResponse.json()).toMatchObject({ code: "unauthenticated", status: 401 });
  });

  it("refuses a body that carries no line", async () => {
    const repository = createRepository();
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify({ ...createBody(), lines: [] }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request", status: 400 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("refuses a store the catalog does not know or does not offer to shoppers", async () => {
    const repository = createRepository();
    const started = await createTestServer(repository);
    server = started.server;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Site not found", { status: 404 })));
    const unknown = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify(createBody()),
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: "invalid_site", status: 400 });

    // A store the pharmacy runs but does not sell from, e.g. the warehouse, is no more usable than an invented id.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ id: ids.site, isActive: false, isCustomerFacing: true })),
    );
    const inactive = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify(createBody()),
    });
    expect(inactive.status).toBe(400);
    expect(await inactive.json()).toMatchObject({ code: "invalid_site", status: 400 });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ id: ids.site, isActive: true, isCustomerFacing: false })),
    );
    const notCustomerFacing = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify(createBody()),
    });
    expect(notCustomerFacing.status).toBe(400);
    expect(await notCustomerFacing.json()).toMatchObject({ code: "invalid_site", status: 400 });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("answers 503 and writes nothing when the catalog cannot say whether the store exists", async () => {
    const repository = createRepository();
    const started = await createTestServer(repository);
    server = started.server;

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    const unreachable = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify(createBody()),
    });
    expect(unreachable.status).toBe(503);
    expect(await unreachable.json()).toMatchObject({ code: "catalog_unavailable", status: 503 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    const failing = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify(createBody()),
    });
    expect(failing.status).toBe(503);
    expect(await failing.json()).toMatchObject({ code: "catalog_unavailable", status: 503 });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("lists only the shopper's own consultations and ignores their site filter", async () => {
    const repository = createRepository();
    repository.list.mockResolvedValue({ rows: [consultation()], nextCursor: undefined });
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(
      `${started.url}/prescriptions/consultations?siteId=${ids.site}&status=Open&limit=10`,
      { headers: { "X-Actor-Id": ids.customer, "X-Actor-Type": "customer" } },
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as PrescriptionConsultation[]).toEqual([consultation()]);
    // The owner filter is not optional on the shopper's side, and someone else's site must not narrow their rows.
    expect(repository.list.mock.calls[0]?.[0]).toEqual({ customerId: ids.customer, status: "Open", limit: 10 });
  });

  it("lets staff list every consultation, narrowed by site and status", async () => {
    const repository = createRepository();
    repository.list.mockResolvedValue({
      rows: [consultation(), consultation({ id: ids.other })],
      nextCursor: undefined,
    });
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(
      `${started.url}/prescriptions/consultations?siteId=${ids.site}&status=Answered&limit=25`,
      { headers: { "X-Actor-Id": ids.pharmacist, "X-Actor-Type": "employee" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(2);
    expect(repository.list.mock.calls[0]?.[0]).toEqual({ siteIds: [ids.site], status: "Answered", limit: 25 });
  });

  it("pages the consultation queue with a cursor header and answers a bad cursor as invalid_cursor", async () => {
    const repository = createRepository();
    const position = { at: "2026-10-08T08:00:00.123456Z", id: ids.consultation };
    repository.list
      .mockResolvedValueOnce({ rows: [consultation()], nextCursor: encodeCursor(position) })
      .mockResolvedValueOnce({ rows: [consultation({ id: ids.other })], nextCursor: undefined });
    const started = await createTestServer(repository);
    server = started.server;
    const staffHeaders = { "X-Actor-Id": ids.pharmacist, "X-Actor-Type": "employee" };

    const first = await httpFetch(`${started.url}/prescriptions/consultations?q=nguyen&limit=1`, {
      headers: staffHeaders,
    });
    expect(first.headers.get("x-next-cursor")).toBe(encodeCursor(position));
    expect(repository.list.mock.calls[0]?.[0]).toEqual({ limit: 1, q: "nguyen" });

    const last = await httpFetch(`${started.url}/prescriptions/consultations?cursor=${encodeCursor(position)}`, {
      headers: staffHeaders,
    });
    expect(last.headers.has("x-next-cursor")).toBe(false);
    expect(repository.list.mock.calls[1]?.[0]).toMatchObject({ limit: 50, after: position });

    const malformed = await httpFetch(`${started.url}/prescriptions/consultations?cursor=%%%`, {
      headers: staffHeaders,
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ title: "Invalid cursor", status: 400, code: "invalid_cursor" });
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it("answers an open consultation", async () => {
    const repository = createRepository();
    const answered = consultation({
      status: "Answered",
      reply: "Dùng Amoxicillin 500mg, 3 lần mỗi ngày.",
      answeredBy: ids.pharmacist,
      answeredAt: "2026-10-08T09:00:00.000Z",
      updatedAt: "2026-10-08T09:00:00.000Z",
    });
    repository.answer.mockResolvedValue({ kind: "answered", consultation: answered });
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(`${started.url}/prescriptions/consultations/${ids.consultation}/answer`, {
      method: "POST",
      headers: pharmacistHeaders,
      body: JSON.stringify({ reply: "Dùng Amoxicillin 500mg, 3 lần mỗi ngày." }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as PrescriptionConsultation).toEqual(answered);
    expect(repository.answer.mock.calls[0]).toEqual([
      ids.consultation,
      "Dùng Amoxicillin 500mg, 3 lần mỗi ngày.",
      ids.pharmacist,
      undefined,
    ]);
  });

  it("answers within the pharmacist's scope and hides another site's consultation behind a 404", async () => {
    const repository = createRepository();
    repository.answer.mockResolvedValue({ kind: "not_found" });
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(`${started.url}/prescriptions/consultations/${ids.consultation}/answer`, {
      method: "POST",
      headers: { ...pharmacistHeaders, "x-actor-site-ids": ids.site },
      body: JSON.stringify({ reply: "Dùng Amoxicillin 500mg." }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "consultation_not_found", status: 404 });
    // The scope comes from the trusted context, so the repository refuses another pharmacy's queue rather than
    // reporting that it exists.
    expect(repository.answer.mock.calls[0]).toEqual([
      ids.consultation,
      "Dùng Amoxicillin 500mg.",
      ids.pharmacist,
      [ids.site],
    ]);
  });

  it("keeps the answer route for staff only", async () => {
    const repository = createRepository();
    const started = await createTestServer(repository);
    server = started.server;

    const response = await httpFetch(`${started.url}/prescriptions/consultations/${ids.consultation}/answer`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify({ reply: "Tôi tự trả lời." }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "staff_only", status: 403 });
    expect(repository.answer).not.toHaveBeenCalled();
  });

  it("reports an unknown consultation and a second answer apart", async () => {
    const repository = createRepository();
    const started = await createTestServer(repository);
    server = started.server;

    repository.answer.mockResolvedValue({ kind: "not_found" });
    const missing = await httpFetch(`${started.url}/prescriptions/consultations/${ids.unknown}/answer`, {
      method: "POST",
      headers: pharmacistHeaders,
      body: JSON.stringify({ reply: "Dùng Amoxicillin 500mg." }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "consultation_not_found", status: 404 });

    repository.answer.mockResolvedValue({
      kind: "already_answered",
      consultation: consultation({ reply: "Đã trả lời." }),
    });
    const answered = await httpFetch(`${started.url}/prescriptions/consultations/${ids.consultation}/answer`, {
      method: "POST",
      headers: pharmacistHeaders,
      body: JSON.stringify({ reply: "Dùng Amoxicillin 500mg." }),
    });
    expect(answered.status).toBe(409);
    expect(await answered.json()).toMatchObject({ code: "consultation_already_answered", status: 409 });
  });

  it("refuses an answer with no actor, an empty reply or a malformed id", async () => {
    const repository = createRepository();
    const started = await createTestServer(repository);
    server = started.server;

    const emptyReply = await httpFetch(`${started.url}/prescriptions/consultations/${ids.consultation}/answer`, {
      method: "POST",
      headers: pharmacistHeaders,
      body: JSON.stringify({ reply: "   " }),
    });
    expect(emptyReply.status).toBe(400);
    expect(await emptyReply.json()).toMatchObject({ code: "invalid_request", status: 400 });

    const malformedId = await httpFetch(`${started.url}/prescriptions/consultations/not-a-uuid/answer`, {
      method: "POST",
      headers: pharmacistHeaders,
      body: JSON.stringify({ reply: "Dùng Amoxicillin 500mg." }),
    });
    expect(malformedId.status).toBe(400);

    const noActor = await httpFetch(`${started.url}/prescriptions/consultations/${ids.consultation}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Type": "employee" },
      body: JSON.stringify({ reply: "Dùng Amoxicillin 500mg." }),
    });
    expect(noActor.status).toBe(401);

    expect(repository.answer).not.toHaveBeenCalled();
  });

  it("answers 503 for every consultation route when the database is not configured", async () => {
    // The repository is undefined, exactly like the sales routes when `DATABASE_URL` is unset.
    const started = await createTestServer(undefined);
    server = started.server;

    const createResponse = await httpFetch(`${started.url}/prescriptions/consultations`, {
      method: "POST",
      headers: shopperHeaders,
      body: JSON.stringify(createBody()),
    });
    expect(createResponse.status).toBe(503);
    expect(await createResponse.json()).toMatchObject({ status: 503 });

    const listResponse = await httpFetch(`${started.url}/prescriptions/consultations`, {
      headers: { "X-Actor-Id": ids.customer, "X-Actor-Type": "customer" },
    });
    expect(listResponse.status).toBe(503);

    const answerResponse = await httpFetch(`${started.url}/prescriptions/consultations/${ids.consultation}/answer`, {
      method: "POST",
      headers: pharmacistHeaders,
      body: JSON.stringify({ reply: "Dùng Amoxicillin 500mg." }),
    });
    expect(answerResponse.status).toBe(503);
  });
});
