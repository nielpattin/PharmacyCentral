import { prescriptionExtractionSchema, type PrescriptionExtraction } from "../../../contracts/prescription-intake.ts";
import { PrescriptionReaderError, type ImageMimeType, type PrescriptionReader } from "../domain/prescription-reader.ts";

/**
 * Reads a printed prescription with a Gemini vision model in one call: the image goes in, JSON that follows
 * `prescriptionExtractionSchema` comes out. A separate OCR step is skipped on purpose. Document-parsing
 * models read Vietnamese diacritics well, but the part that matters here, telling the medicine lines from the
 * header, dosing text and stamps, is layout understanding that a single multimodal call does better than OCR text
 * handed to a second model. The API key is only read here and never reaches the browser.
 *
 * Nothing is stored: the photo is sent, the answer is parsed and both are dropped, because the page carries a
 * patient's name, diagnosis and medicines.
 */

type GeminiOptions = { baseUrl: string; apiKey: string; model: string };

const REQUEST_TIMEOUT_MS = 45_000;

const SYSTEM_INSTRUCTION = `You read photos of PRINTED Vietnamese medical prescriptions (đơn thuốc) for a pharmacy.
Return only the JSON the schema asks for.

Rules:
- If the image is not a medical prescription, set isPrescription to false and lines to [].
- Add one entry to lines for every medicine on the prescription, in printed order. Never merge two medicines and never invent one.
- rawText is the medicine line exactly as printed, diacritics included, without the dosing instructions.
- name is the prescribed name as printed, together with its strength when printed there ("Augmentin 625mg", "Paracetamol 500mg").
- activeIngredients lists the ingredients printed on the document, usually inside parentheses after a brand name or as the generic name itself ("Amoxicillin", "Acid clavulanic"). Split combinations into separate entries. Do not add ingredients from your own knowledge; use [] when none is printed.
- strength is the strength as printed ("500 mg", "625 mg"); for a combination join them with " + ". Use null when none is printed.
- quantity is the number of units to dispense and unit is its printed unit (viên, gói, chai, ống...). usage is the printed dosing instruction ("Sáng 1 viên, tối 1 viên sau ăn").
- Copy header fields (code, patientName, facilityName, doctorName, diagnosis, issuedOn) as printed. The prescription code looks like "a1b2c3d4e5f6-C". Use null for anything missing or illegible.
- Never guess. If a value is unclear, use null instead.`;

const nullable = (type: string) => ({ type: [type, "null"] });

/** The subset of JSON Schema that the Gemini API accepts, mirroring `prescriptionExtractionSchema`. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    isPrescription: { type: "boolean" },
    code: nullable("string"),
    patientName: nullable("string"),
    facilityName: nullable("string"),
    doctorName: nullable("string"),
    diagnosis: nullable("string"),
    issuedOn: nullable("string"),
    lines: {
      type: "array",
      // No maxItems: Gemini rejects maxItems >= 20 over this item schema with a bare 400.
      // prescriptionExtractionSchema still caps lines at 30.
      items: {
        type: "object",
        properties: {
          rawText: { type: "string" },
          name: nullable("string"),
          activeIngredients: { type: "array", maxItems: 10, items: { type: "string" } },
          strength: nullable("string"),
          dosageForm: nullable("string"),
          quantity: nullable("number"),
          unit: nullable("string"),
          usage: nullable("string"),
        },
        required: ["rawText", "name", "activeIngredients", "strength", "dosageForm", "quantity", "unit", "usage"],
      },
    },
  },
  required: ["isPrescription", "code", "patientName", "facilityName", "doctorName", "diagnosis", "issuedOn", "lines"],
};

type GeminiResponse = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
};

export class GeminiPrescriptionReader implements PrescriptionReader {
  public constructor(private readonly options: GeminiOptions) {}

  public async read(image: Buffer, mimeType: ImageMimeType): Promise<PrescriptionExtraction> {
    const url = new URL(
      `/v1beta/models/${encodeURIComponent(this.options.model)}:generateContent`,
      this.options.baseUrl,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: image.toString("base64") } },
                { text: "Extract this prescription." },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new PrescriptionReaderError("unavailable", "Gemini request failed", { cause });
    }
    if (!response.ok) {
      // The body can echo request details, so only the status is kept.
      throw new PrescriptionReaderError("unavailable", `Gemini answered HTTP ${response.status}`);
    }

    // A gateway in front of the API can answer 200 with an HTML page or another JSON literal. Its bytes stay out
    // of the error on purpose: a parse failure carries a slice of the body, which can hold prescription content.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PrescriptionReaderError("unavailable", "Gemini returned a non-JSON response");
    }
    if (typeof payload !== "object" || payload === null) {
      throw new PrescriptionReaderError("unavailable", "Gemini returned an unexpected response shape");
    }
    const body = payload as GeminiResponse;
    if (body.promptFeedback?.blockReason) {
      throw new PrescriptionReaderError("unreadable", `Gemini blocked the image: ${body.promptFeedback.blockReason}`);
    }
    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) {
      throw new PrescriptionReaderError(
        "unreadable",
        `Gemini returned no text (finish reason ${candidate?.finishReason})`,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // Same reason as above: the SyntaxError message quotes the text it could not parse, and that text is the
      // model's reading of the prescription.
      throw new PrescriptionReaderError("unreadable", "Gemini returned invalid JSON");
    }
    const parsed = prescriptionExtractionSchema.safeParse(json);
    if (!parsed.success) throw new PrescriptionReaderError("unreadable", "Gemini returned an unexpected shape");
    return parsed.data;
  }
}
