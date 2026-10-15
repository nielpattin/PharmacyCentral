/**
 * Generates the fictional printed prescriptions in `data/prescription-samples/` used to demo prescription intake.
 * Each scenario produces `<slug>.png` (with a QR code), `<slug>-no-qr.png` (same page without the QR, to exercise the
 * Gemini image path) and `<slug>.json` (ground truth). The pages follow the form in Appendix I of Circular
 * 26/2025/TT-BYT and are rendered from SVG with fonts loaded explicitly, so reruns produce identical files. The real
 * national system resolves the 14 character prescription code to the medicines through a vendor-credentialed pharmacy
 * API; until that exists the QR carries the medicine items inline (using that API's `thong_tin_don_thuoc` field
 * names), so a scanned code can be turned into suggestions without any lookup. Every QR is decoded again with jsQR
 * after rendering so a layout or payload regression fails the script instead of shipping an unscannable fixture.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deepStrictEqual } from "node:assert/strict";
import * as jsQrModule from "jsqr";
import type { Options as JsQrOptions, QRCode as DecodedQr } from "jsqr";
import QRCode from "qrcode";
import { Resvg } from "@resvg/resvg-js";
import { prescriptionQrPayloadSchema, type PrescriptionQrPayload } from "../src/contracts/prescription-intake.ts";

// jsqr ships a webpack UMD bundle, and under `module: NodeNext` its declaration file types every import form of it
// as the CommonJS exports object, callable included. At runtime the callable is the `default` of that object, which
// is why the narrowing below is what `node` actually runs.
const jsQR = jsQrModule.default as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  providedOptions?: JsQrOptions,
) => DecodedQr | null;

type Medicine = {
  /** Line as printed, e.g. "Hapacol 650 (Paracetamol 650mg)". */
  printed: string;
  ten_thuoc: string;
  biet_duoc: string;
  don_vi_tinh: string;
  so_luong: number;
  /** Usage as printed under the line. */
  usage: string;
  /** Short usage carried by the QR. */
  cach_dung: string;
};

type Scenario = {
  slug: string;
  facility: { ten: string; dia_chi: string; dien_thoai: string };
  patient: {
    ho_ten: string;
    cccd: string;
    ngay_sinh: string;
    can_nang_kg: number;
    gioi_tinh: "Nam" | "Nữ";
    ma_bhyt: string;
    noi_thuong_tru: string;
  };
  diagnoses: Array<{ ma_icd: string; ten: string }>;
  medicines: Medicine[];
  /** Diet and return-visit advice printed under "Lời dặn". */
  advice: string[];
  doctor: string;
};

const WIDTH = 1050;
const HEIGHT = 1480;
const MARGIN = 60;
const RIGHT = WIDTH - MARGIN;
const BODY_LIMIT = 1430;
const DISCLAIMER = "Đơn mẫu dùng để thử nghiệm phần mềm — không có giá trị kê đơn";

const scenarios: Scenario[] = [
  {
    slug: "tang-huyet-ap-dai-thao-duong",
    facility: {
      ten: "Phòng khám Nội tiết - Tim mạch Phúc Lộc (mẫu)",
      dia_chi: "5 Đường Nguyễn Thị Thập, Phường Tân Hưng, Quận 7, TP. Hồ Chí Minh",
      dien_thoai: "028 7300 0303",
    },
    patient: {
      ho_ten: "Lê Văn Thịnh",
      cccd: "079051007788",
      ngay_sinh: "21/11/1951",
      can_nang_kg: 68,
      gioi_tinh: "Nam",
      ma_bhyt: "HT3790077889",
      noi_thuong_tru: "301 Đường Huỳnh Tấn Phát, Phường Tân Thuận Tây, Quận 7, TP. Hồ Chí Minh",
    },
    diagnoses: [
      { ma_icd: "I10", ten: "Tăng huyết áp vô căn (nguyên phát)" },
      { ma_icd: "E11", ten: "Đái tháo đường không phụ thuộc insulin" },
    ],
    medicines: [
      {
        printed: "Amlodipin 5mg",
        ten_thuoc: "Amlodipin 5mg",
        biet_duoc: "Amlodipin",
        don_vi_tinh: "Viên",
        so_luong: 30,
        usage: "Sáng 1 viên, uống 30 ngày",
        cach_dung: "Sáng 1 viên",
      },
      {
        printed: "Savi Losartan 50mg (Losartan)",
        ten_thuoc: "Savi Losartan 50mg",
        biet_duoc: "Losartan",
        don_vi_tinh: "Viên",
        so_luong: 30,
        usage: "Sáng 1 viên, uống 30 ngày",
        cach_dung: "Sáng 1 viên",
      },
      {
        printed: "Diamicron MR 30mg (Gliclazide)",
        ten_thuoc: "Diamicron MR 30mg",
        biet_duoc: "Gliclazide",
        don_vi_tinh: "Viên",
        so_luong: 30,
        usage: "Sáng 1 viên trước ăn sáng, uống 30 ngày",
        cach_dung: "Sáng 1 trước ăn",
      },
      {
        printed: "Atorvastatin 20mg",
        ten_thuoc: "Atorvastatin 20mg",
        biet_duoc: "Atorvastatin",
        don_vi_tinh: "Viên",
        so_luong: 30,
        usage: "Tối 1 viên, uống 30 ngày",
        cach_dung: "Tối 1 viên",
      },
      {
        printed: "Plavix 75mg (Clopidogrel)",
        ten_thuoc: "Plavix 75mg",
        biet_duoc: "Clopidogrel",
        don_vi_tinh: "Viên",
        so_luong: 30,
        usage: "Sáng 1 viên sau ăn, uống 30 ngày",
        cach_dung: "Sáng 1 sau ăn",
      },
      {
        printed: "Aspirin 81mg (Acid acetylsalicylic)",
        ten_thuoc: "Aspirin 81mg",
        biet_duoc: "Acid acetylsalicylic",
        don_vi_tinh: "Viên",
        so_luong: 30,
        usage: "Sáng 1 viên sau ăn, uống 30 ngày",
        cach_dung: "Sáng 1 sau ăn",
      },
    ],
    advice: ["Ăn nhạt, hạn chế đường và tinh bột.", "Tái khám sau 30 ngày, mang theo sổ theo dõi."],
    doctor: "BS. Phạm Đức Hùng",
  },
];

const FONT_DIR = path.join(import.meta.dirname, "fonts");
const OUT_DIR = path.resolve(import.meta.dirname, "../../../data/prescription-samples");

// Five digits of facility code plus seven [0-9a-z] characters, both derived from the slug so reruns match.
function prescriptionCode(slug: string): string {
  const bytes = createHash("sha256").update(slug).digest();
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += String(bytes[i]! % 10);
  for (let i = 5; i < 12; i += 1) code += alphabet[bytes[i]! % alphabet.length];
  return `${code}-C`;
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(value: string, budget: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    if (line && line.length + 1 + word.length > budget) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines;
}

function buildPayload(scenario: Scenario): PrescriptionQrPayload {
  return prescriptionQrPayloadSchema.parse({
    ma_don_thuoc: prescriptionCode(scenario.slug),
    thong_tin_don_thuoc: scenario.medicines.map((m) => ({
      biet_duoc: m.biet_duoc,
      ten_thuoc: m.ten_thuoc,
      don_vi_tinh: m.don_vi_tinh,
      so_luong: m.so_luong,
      cach_dung: m.cach_dung,
    })),
  });
}

/** QR drawn as crisp SVG rects, an integer number of pixels per module, quiet zone included in the size. */
function qrSvg(text: string, right: number, bottom: number): { svg: string; top: number } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const quiet = 4;
  const total = modules.size + quiet * 2;
  const scale = Math.max(3, Math.round(300 / total));
  const size = total * scale;
  const left = right - size;
  const top = bottom - size;
  const rects: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col)) {
        rects.push(
          `<rect x="${left + (col + quiet) * scale}" y="${top + (row + quiet) * scale}" width="${scale}" height="${scale}"/>`,
        );
      }
    }
  }
  const svg = `<rect x="${left}" y="${top}" width="${size}" height="${size}" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${rects.join("")}</g>`;
  return { svg, top };
}

function checkbox(x: number, y: number, checked: boolean): string {
  const box = `<rect x="${x}" y="${y - 18}" width="20" height="20" fill="none" stroke="#000" stroke-width="2"/>`;
  if (!checked) return box;
  return `${box}<path d="M${x + 4} ${y - 14}L${x + 16} ${y - 2}M${x + 16} ${y - 14}L${x + 4} ${y - 2}" stroke="#000" stroke-width="2.5"/>`;
}

function buildSvg(
  scenario: Scenario,
  payload: PrescriptionQrPayload,
  qr: { svg: string; top: number },
  withQr: boolean,
): string {
  const parts: string[] = [];
  const { patient } = scenario;

  const text = (
    x: number,
    y: number,
    content: string,
    { size = 22, bold = false, anchor = "start" }: { size?: number; bold?: boolean; anchor?: string } = {},
  ): void => {
    parts.push(
      `<text x="${x}" y="${y}" font-size="${size}"${bold ? ' font-weight="bold"' : ""} text-anchor="${anchor}">${esc(content)}</text>`,
    );
  };

  /** Regular label followed by a bold value, wrapped by character budget. Returns the next y. */
  const field = (x: number, y: number, label: string, value: string, budget: number): number => {
    const lines = wrap(`${label} ${value}`, budget);
    lines.forEach((line, index) => {
      if (index === 0) {
        parts.push(
          `<text x="${x}" y="${y}" font-size="22">${esc(label)} <tspan font-weight="bold">${esc(line.slice(label.length + 1))}</tspan></text>`,
        );
      } else {
        text(x, y + index * 30, line, { bold: true });
      }
    });
    return y + lines.length * 30;
  };

  // Header: facility on the left, prescription code box top-right.
  let y = 80;
  y = field(MARGIN, y, "Tên đơn vị:", scenario.facility.ten, 38);
  y = field(MARGIN, y + 4, "Địa chỉ:", scenario.facility.dia_chi, 42);
  y = field(MARGIN, y + 4, "Điện thoại:", scenario.facility.dien_thoai, 42);
  parts.push(`<rect x="${RIGHT - 390}" y="50" width="390" height="56" fill="none" stroke="#000" stroke-width="2"/>`);
  parts.push(
    `<text x="${RIGHT - 195}" y="86" font-size="22" text-anchor="middle">Mã đơn thuốc: <tspan font-weight="bold">${esc(payload.ma_don_thuoc)}</tspan></text>`,
  );

  y = Math.max(y, 150) + 60;
  text(WIDTH / 2, y, "ĐƠN THUỐC", { size: 46, bold: true, anchor: "middle" });

  // Patient block.
  y += 56;
  field(MARGIN, y, "Họ tên:", patient.ho_ten, 40);
  const genderX = 690;
  text(genderX, y, "Giới tính:");
  parts.push(checkbox(genderX + 112, y, patient.gioi_tinh === "Nam"));
  text(genderX + 140, y, "Nam");
  parts.push(checkbox(genderX + 212, y, patient.gioi_tinh === "Nữ"));
  text(genderX + 240, y, "Nữ");
  y += 36;
  field(MARGIN, y, "Số định danh cá nhân/CCCD:", patient.cccd, 50);
  field(640, y, "Ngày sinh:", patient.ngay_sinh, 30);
  y += 36;
  field(MARGIN, y, "Mã số bảo hiểm y tế:", patient.ma_bhyt, 40);
  field(640, y, "Cân nặng:", `${patient.can_nang_kg} kg`, 30);
  y += 36;
  y = field(MARGIN, y, "Nơi thường trú:", patient.noi_thuong_tru, 66) + 6;
  const diagnosis = scenario.diagnoses.map((d) => `${d.ma_icd} - ${d.ten}`).join("; ");
  y = field(MARGIN, y, "Chẩn đoán:", diagnosis, 66) + 16;

  // Medicines.
  text(MARGIN, y, "Thuốc điều trị:", { bold: true });
  y += 42;
  scenario.medicines.forEach((medicine, index) => {
    const lines = wrap(`${index + 1}) ${medicine.printed}`, 60);
    lines.forEach((line, lineIndex) => {
      text(lineIndex === 0 ? MARGIN : MARGIN + 34, y + lineIndex * 32, line, { size: 24, bold: true });
    });
    text(RIGHT, y, `SL: ${medicine.so_luong} ${medicine.don_vi_tinh}`, {
      size: 24,
      anchor: "end",
    });
    y += lines.length * 32;
    for (const line of wrap(medicine.usage, 80)) {
      text(MARGIN + 34, y, line, { size: 21 });
      y += 28;
    }
    y += 12;
  });
  const medicinesEnd = y;

  // Left column below the medicines: advice, then signature. The QR owns the bottom-right corner.
  y += 16;
  text(MARGIN, y, "Lời dặn:", { bold: true });
  y += 32;
  const advice = [
    "- Khám bệnh lại xin mang theo đơn này.",
    ...scenario.advice.map((line) => `- ${line}`),
    `- Số điện thoại liên hệ: ${scenario.facility.dien_thoai}`,
  ];
  for (const item of advice) {
    for (const line of wrap(item, 46)) {
      text(MARGIN, y, line);
      y += 28;
    }
  }
  y += 18;
  const centerX = MARGIN + 260;
  text(centerX, y, "Ngày ... tháng ... năm 2026", { anchor: "middle" });
  text(centerX, y + 30, "Bác sỹ/Y sỹ khám bệnh", { bold: true, anchor: "middle" });
  text(centerX, y + 58, "(Ký, ghi rõ họ tên)", { size: 20, anchor: "middle" });
  y += 130;
  text(centerX, y, scenario.doctor, { bold: true, anchor: "middle" });

  if (y > BODY_LIMIT) throw new Error(`${scenario.slug}: content overflows the page (y=${y})`);
  // Medicines sit above the QR, which is reserved even on the no-QR variant so both pages are identical otherwise.
  if (medicinesEnd > qr.top - 10) {
    throw new Error(`${scenario.slug}: medicines (y=${medicinesEnd}) run into the QR (y=${qr.top})`);
  }
  if (withQr) parts.push(qr.svg);
  text(WIDTH / 2, HEIGHT - 22, DISCLAIMER, { size: 18, anchor: "middle" });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Noto Sans" fill="#000"><rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>${parts.join("")}</svg>`;
}

function render(svg: string): Resvg {
  return new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      fontFiles: [path.join(FONT_DIR, "NotoSans-Regular.ttf"), path.join(FONT_DIR, "NotoSans-Bold.ttf")],
      loadSystemFonts: false,
      defaultFontFamily: "Noto Sans",
    },
  });
}

function write(file: string, content: string | Buffer): void {
  writeFileSync(path.join(OUT_DIR, file), content);
  console.log(`wrote data/prescription-samples/${file}`);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const scenario of scenarios) {
  const payload = buildPayload(scenario);
  const text = JSON.stringify(payload);
  const bytes = Buffer.byteLength(text);
  if (bytes >= 1000) throw new Error(`${scenario.slug}: QR payload is ${bytes} bytes, keep it under 1000`);

  const qr = qrSvg(text, RIGHT, BODY_LIMIT + 10);
  const withQr = render(buildSvg(scenario, payload, qr, true));

  const image = withQr.render();
  const decoded = jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height);
  if (!decoded) {
    console.error(`${scenario.slug}: jsQR could not find a QR code in the rendered page`);
    process.exit(1);
  }
  try {
    deepStrictEqual(prescriptionQrPayloadSchema.parse(JSON.parse(decoded.data)), payload);
  } catch (error) {
    console.error(`${scenario.slug}: decoded QR does not match the payload: ${String(error)}`);
    process.exit(1);
  }

  write(`${scenario.slug}.png`, image.asPng());
  write(
    `${scenario.slug}-no-qr.png`,
    render(buildSvg(scenario, payload, qr, false))
      .render()
      .asPng(),
  );
  write(
    `${scenario.slug}.json`,
    `${JSON.stringify(
      {
        ...payload,
        co_so: scenario.facility,
        benh_nhan: scenario.patient,
        chan_doan: scenario.diagnoses,
        loi_dan: scenario.advice,
        bac_si: scenario.doctor,
        ngay_ke_don_nam: 2026,
      },
      null,
      2,
    )}\n`,
  );
}
