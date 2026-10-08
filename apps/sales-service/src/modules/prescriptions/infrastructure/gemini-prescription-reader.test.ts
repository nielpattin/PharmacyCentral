import { afterEach, describe, expect, it, vi } from "vitest";

import { PrescriptionReaderError } from "../domain/prescription-reader.ts";
import { GeminiPrescriptionReader } from "./gemini-prescription-reader.ts";

const reader = new GeminiPrescriptionReader({
  baseUrl: "https://gemini.test",
  apiKey: "secret-key",
  model: "gemini-test",
});
const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const answer = (text: string, finishReason = "STOP") =>
  Response.json({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });

const failureOf = (outcome: Response | Error) => {
  vi.stubGlobal("fetch", async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  return reader.read(image, "image/png").catch((error: unknown) => error);
};

/** Every message in the error's cause chain, which is what a log line would carry. */
const messagesOf = (error: unknown): string => {
  const messages: string[] = [];
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  return messages.join("\n");
};

/**
 * Whether those messages repeat any eight characters of `source`. A JSON parse failure quotes a window of the text
 * it could not parse, so this catches a response body or model output reaching a log line even one fragment at a
 * time.
 */
const leaks = (error: unknown, source: string): boolean => {
  const messages = messagesOf(error);
  for (let start = 0; start + 8 <= source.length; start += 1) {
    if (messages.includes(source.slice(start, start + 8))) return true;
  }
  return false;
};

const validExtraction = {
  isPrescription: true,
  code: null,
  patientName: null,
  facilityName: null,
  doctorName: null,
  diagnosis: null,
  issuedOn: null,
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
};

describe("GeminiPrescriptionReader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the image with the key in a header and returns the validated extraction", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => answer(JSON.stringify(validExtraction)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await reader.read(image, "image/jpeg");

    expect(result).toEqual(validExtraction);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://gemini.test/v1beta/models/gemini-test:generateContent");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "secret-key" });
    expect(String(url)).not.toContain("secret-key");
    const body = JSON.parse(init?.body as string) as {
      contents: Array<{ parts: Array<{ inlineData?: { mimeType: string; data: string } }> }>;
      generationConfig: { responseMimeType: string };
    };
    expect(body.contents[0]?.parts[0]?.inlineData).toEqual({ mimeType: "image/jpeg", data: image.toString("base64") });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("treats provider failures as unavailable and malformed answers as unreadable", async () => {
    const cases: Array<[Response | Error, "unavailable" | "unreadable"]> = [
      [new Response("quota", { status: 429 }), "unavailable"],
      [new Error("socket hang up"), "unavailable"],
      // A 200 that is not JSON, or JSON that is not the API envelope, failed before any answer came back.
      [new Response("<html>proxy</html>", { status: 200 }), "unavailable"],
      [new Response("null", { status: 200 }), "unavailable"],
      [Response.json({ promptFeedback: { blockReason: "SAFETY" } }), "unreadable"],
      // Gemini answered, but with no candidate at all.
      [Response.json({ candidates: [] }), "unreadable"],
      [Response.json({}), "unreadable"],
      [answer("not json"), "unreadable"],
      [answer(JSON.stringify({ ...validExtraction, lines: [{ rawText: "" }] })), "unreadable"],
    ];
    for (const [outcome, kind] of cases) {
      const failure = await failureOf(outcome);
      expect(failure).toBeInstanceOf(PrescriptionReaderError);
      expect((failure as PrescriptionReaderError).kind).toBe(kind);
    }
  });

  it("keeps a non-JSON response body out of the error it reports", async () => {
    // A proxy in front of the API answers 200 with a page of its own, and the page can echo prescription content.
    const bodies = [
      "<html><body>proxy error — Paracetamol 500mg cho Nguyễn Văn An</body></html>",
      "Paracetamol 500mg cho Nguyễn Văn An",
    ];
    for (const body of bodies) {
      const failure = await failureOf(new Response(body, { status: 200 }));

      expect(failure).toBeInstanceOf(PrescriptionReaderError);
      expect((failure as PrescriptionReaderError).kind).toBe("unavailable");
      expect(leaks(failure, body)).toBe(false);
    }
  });

  it("maps a truncated answer to unreadable without quoting the model output", async () => {
    const truncated = '{"isPrescription":true,"lines":[{"rawText":"Paracetamol 500mg"},]}';
    const failure = await failureOf(answer(truncated, "MAX_TOKENS"));

    expect(failure).toBeInstanceOf(PrescriptionReaderError);
    expect(failure).not.toBeInstanceOf(SyntaxError);
    expect((failure as PrescriptionReaderError).kind).toBe("unreadable");
    expect(leaks(failure, truncated)).toBe(false);
  });
});
