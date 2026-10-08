import { describe, expect, it } from "vitest";

import { prescriptionQrRequestSchema } from "../../../contracts/prescription-intake.ts";
import { linesFromQr, parsePrescriptionQr } from "./prescription-qr.ts";

type QrItem = {
  biet_duoc: string;
  ten_thuoc: string;
  don_vi_tinh: string;
  so_luong: number;
  cach_dung: string;
};

const item = (overrides: Partial<QrItem> = {}): QrItem => ({
  biet_duoc: "Paracetamol",
  ten_thuoc: "Paracetamol 500mg",
  don_vi_tinh: "viên",
  so_luong: 20,
  cach_dung: "Sáng 1 viên",
  ...overrides,
});

/** Goes through the parser, so a test can never assert against a payload the route would have rejected. */
const qrPayload = (items: QrItem[]) => {
  const payload = parsePrescriptionQr(JSON.stringify({ ma_don_thuoc: "1a2b3c4d5e6f-C", thong_tin_don_thuoc: items }));
  if (!payload) throw new Error("the test payload is not a valid prescription QR");
  return payload;
};

describe("parsePrescriptionQr", () => {
  it("accepts a national e-prescription payload and keeps its Vietnamese text", () => {
    const payload = {
      ma_don_thuoc: "1a2b3c4d5e6f-C",
      thong_tin_don_thuoc: [
        item({
          biet_duoc: "Amoxicillin + Acid clavulanic",
          ten_thuoc: "Augmentin 625mg",
          cach_dung: "Sáng 1 viên, tối 1 viên sau ăn",
        }),
      ],
    };

    expect(parsePrescriptionQr(JSON.stringify(payload))).toEqual(payload);
  });

  it("accepts the uppercase code letter and the traditional medicine type, as appendix I allows", () => {
    for (const code of ["1A2B3C4D5E6F-C", "1a2b3c4d5e6f-Y", "1a2b3c4d5e6f-h"]) {
      const parsed = parsePrescriptionQr(JSON.stringify({ ma_don_thuoc: code, thong_tin_don_thuoc: [item()] }));
      expect(parsed?.ma_don_thuoc).toBe(code);
    }
  });

  it("rejects text that is not a prescription QR payload", () => {
    const code = { ma_don_thuoc: "1a2b3c4d5e6f-C" };
    const rejects = [
      "not json at all",
      "https://donthuocquocgia.vn/1a2b3c4d5e6f-C",
      "null",
      "[]",
      JSON.stringify({ ma_don_thuoc: "1a2b3c4d5e6f-C" }),
      JSON.stringify({ ...code, thong_tin_don_thuoc: [] }),
      JSON.stringify({ thong_tin_don_thuoc: [item()] }),
      // The code is twelve characters, a dash and a type letter: C, N, H or Y.
      JSON.stringify({ ma_don_thuoc: "1a2b3c4d5e6-C", thong_tin_don_thuoc: [item()] }),
      JSON.stringify({ ma_don_thuoc: "1a2b3c4d5e6f-Z", thong_tin_don_thuoc: [item()] }),
      JSON.stringify({ ...code, thong_tin_don_thuoc: [item({ so_luong: 0 })] }),
      JSON.stringify({ ...code, thong_tin_don_thuoc: [item({ biet_duoc: "" })] }),
    ];

    for (const text of rejects) expect(parsePrescriptionQr(text)).toBeUndefined();
  });

  it("rejects a payload past the caps of the item schema", () => {
    const code = { ma_don_thuoc: "1a2b3c4d5e6f-C" };
    const one = (overrides: Partial<QrItem>) => JSON.stringify({ ...code, thong_tin_don_thuoc: [item(overrides)] });

    expect(
      parsePrescriptionQr(JSON.stringify({ ...code, thong_tin_don_thuoc: Array.from({ length: 31 }, () => item()) })),
    ).toBeUndefined();
    expect(parsePrescriptionQr(one({ biet_duoc: "x".repeat(501) }))).toBeUndefined();
    expect(parsePrescriptionQr(one({ ten_thuoc: "x".repeat(501) }))).toBeUndefined();
    expect(parsePrescriptionQr(one({ so_luong: 100_001 }))).toBeUndefined();
    expect(parsePrescriptionQr(one({ cach_dung: "x".repeat(501) }))).toBeUndefined();
  });

  it("caps the payload string in the request schema, not in the parser", () => {
    const long = item({ biet_duoc: "x".repeat(500), ten_thuoc: "y".repeat(500) });
    const text = JSON.stringify({
      ma_don_thuoc: "1a2b3c4d5e6f-C",
      thong_tin_don_thuoc: Array.from({ length: 30 }, () => long),
    });

    expect(text.length).toBeGreaterThan(8_000);
    // The 8000 character cap that keeps a QR from being an upload sits in `prescriptionQrRequestSchema`, in front of
    // this parser; what this parser bounds is each field and the number of items.
    expect(parsePrescriptionQr(text)).toBeDefined();
    expect(prescriptionQrRequestSchema.safeParse({ payload: text }).success).toBe(false);
  });
});

describe("linesFromQr", () => {
  it("maps an item to the line shape the image reader produces", () => {
    const [line] = linesFromQr(
      qrPayload([
        item({
          biet_duoc: "Amoxicillin + Acid clavulanic",
          ten_thuoc: "Augmentin 625mg",
          don_vi_tinh: "viên",
          so_luong: 14,
          cach_dung: "Sáng 1 viên, tối 1 viên sau ăn",
        }),
      ]),
    );

    expect(line).toEqual({
      rawText: "Augmentin 625mg (Amoxicillin + Acid clavulanic)",
      name: "Augmentin 625mg",
      activeIngredients: ["Amoxicillin", "Acid clavulanic"],
      strength: "625mg",
      dosageForm: null,
      quantity: 14,
      unit: "viên",
      usage: "Sáng 1 viên, tối 1 viên sau ăn",
    });
  });

  it("keeps the printed order and the diacritics of every item", () => {
    const lines = linesFromQr(
      qrPayload([
        item({ biet_duoc: "Cao lá thường xuân", ten_thuoc: "Thuốc ho Bảo Thanh" }),
        item({ ten_thuoc: "Paracetamol 500mg" }),
      ]),
    );

    expect(lines.map((line) => line.name)).toEqual(["Thuốc ho Bảo Thanh", "Paracetamol 500mg"]);
    expect(lines[0]?.rawText).toBe("Thuốc ho Bảo Thanh (Cao lá thường xuân)");
  });

  it("prints the ingredient in parentheses only when it says more than the name", () => {
    const [same, different] = linesFromQr(
      qrPayload([
        item({ biet_duoc: "Paracetamol", ten_thuoc: "Paracetamol " }),
        item({ biet_duoc: "Paracetamol", ten_thuoc: "Hapacol 650" }),
      ]),
    );

    expect(same?.rawText).toBe("Paracetamol");
    expect(different?.rawText).toBe("Hapacol 650 (Paracetamol)");
  });

  it("splits a combination on +, , and ;", () => {
    const lines = linesFromQr(
      qrPayload([
        item({ biet_duoc: "Amoxicillin + Acid clavulanic" }),
        item({ biet_duoc: "Paracetamol, Caffeine" }),
        item({ biet_duoc: "Paracetamol;Caffeine" }),
        item({ biet_duoc: " Paracetamol , Caffeine " }),
        item({ biet_duoc: "Paracetamol +" }),
      ]),
    );

    expect(lines.map((line) => line.activeIngredients)).toEqual([
      ["Amoxicillin", "Acid clavulanic"],
      ["Paracetamol", "Caffeine"],
      ["Paracetamol", "Caffeine"],
      ["Paracetamol", "Caffeine"],
      ["Paracetamol"],
    ]);
  });

  it("falls back to the strength stated next to the ingredient when the name states none", () => {
    const lines = linesFromQr(
      qrPayload([
        item({ biet_duoc: "Paracetamol 650mg", ten_thuoc: "Hapacol 650" }),
        item({ biet_duoc: "Paracetamol", ten_thuoc: "Paracetamol 500 mg" }),
        item({ biet_duoc: "Paracetamol", ten_thuoc: "Hapacol 650" }),
        item({ biet_duoc: "Amoxicillin 500mg + Acid clavulanic 125mg", ten_thuoc: "Augmentin 625mg" }),
        item({ biet_duoc: "Amoxicillin 500mg + Acid clavulanic 125mg", ten_thuoc: "Augmentin" }),
      ]),
    );

    expect(lines.map((line) => line.strength)).toEqual(["650mg", "500 mg", null, "625mg", "500mg + 125mg"]);
  });

  it("reports a missing usage as null instead of an empty string", () => {
    const [line] = linesFromQr(qrPayload([item({ cach_dung: "" })]));

    expect(line?.usage).toBeNull();
  });
});
