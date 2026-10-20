import { describe, expect, it } from "vitest";

import type { AiProviderSettings } from "../../../infrastructure/ai-provider-config.ts";
import type { PrescriptionExtraction } from "../../../contracts/prescription-intake.ts";
import { createAdapterSource } from "../../credentials/ai-adapters.ts";
import { PrescriptionReaderError } from "../domain/prescription-reader.ts";
import { ConfiguredPrescriptionReader, type PrescriptionAdapter } from "./configured-prescription-reader.ts";

const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const SETTINGS: AiProviderSettings = {
  provider: "gemini",
  model: "example-model-1",
  baseUrl: "https://provider.example.test",
  apiKey: "example-key-1234",
};
const EXTRACTION: PrescriptionExtraction = {
  isPrescription: true,
  code: null,
  patientName: null,
  facilityName: null,
  doctorName: null,
  diagnosis: null,
  issuedOn: null,
  lines: [],
};

const fail = (): PrescriptionAdapter => {
  throw new Error("adapter built without settings");
};

describe("ConfiguredPrescriptionReader", () => {
  it("is unavailable and reports no provider when there are no settings", async () => {
    const reader = new ConfiguredPrescriptionReader(
      createAdapterSource(async () => undefined, { gemini: () => fail() }),
    );

    expect(await reader.isAvailable()).toBe(false);
    const failure = await reader.read(image, "image/jpeg").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PrescriptionReaderError);
    expect((failure as PrescriptionReaderError).kind).toBe("unavailable");
    expect(failure).toHaveProperty("message", "No AI provider is configured");
  });

  it("treats a failing settings read as unavailable with the cause attached", async () => {
    const cause = new Error("database down");
    const reader = new ConfiguredPrescriptionReader(
      createAdapterSource(
        async () => {
          throw cause;
        },
        { gemini: () => fail() },
      ),
    );

    expect(await reader.isAvailable()).toBe(false);
    const failure = await reader.read(image, "image/jpeg").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PrescriptionReaderError);
    expect((failure as PrescriptionReaderError).kind).toBe("unavailable");
    expect(failure).toHaveProperty("cause", cause);
  });

  it("reads through the adapter built from exactly the settings it resolved", async () => {
    const built: AiProviderSettings[] = [];
    const adapter: PrescriptionAdapter = { read: async () => EXTRACTION };
    const reader = new ConfiguredPrescriptionReader(
      createAdapterSource(async () => SETTINGS, {
        gemini: (settings) => {
          built.push(settings);
          return adapter;
        },
      }),
    );

    expect(await reader.isAvailable()).toBe(true);
    expect(await reader.read(image, "image/jpeg")).toBe(EXTRACTION);
    expect(built).toEqual([SETTINGS, SETTINGS]);
  });

  it("follows a settings change and goes back to unavailable when they are cleared", async () => {
    let current: AiProviderSettings | undefined = SETTINGS;
    const reader = new ConfiguredPrescriptionReader(
      createAdapterSource(async () => current, {
        gemini: (settings) => ({
          read: async () => ({ ...EXTRACTION, code: settings.model }),
        }),
      }),
    );

    expect(await reader.read(image, "image/jpeg")).toMatchObject({ code: "example-model-1" });

    current = { ...SETTINGS, model: "example-model-2" };

    expect(await reader.read(image, "image/jpeg")).toMatchObject({ code: "example-model-2" });
    current = undefined;
    expect(await reader.isAvailable()).toBe(false);
    await expect(reader.read(image, "image/jpeg")).rejects.toThrow("No AI provider is configured");
  });
});
