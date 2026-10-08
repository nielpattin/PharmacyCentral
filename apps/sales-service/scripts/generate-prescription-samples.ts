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
    /** Only for children under 72 months. */
    nguoi_dua_tre?: string;
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
    slug: "cam-cum",
    facility: {
      ten: "Phòng khám Đa khoa Hoa Sen (mẫu)",
      dia_chi: "12 Đường Số 5, Phường Tân Phú, Quận 7, TP. Hồ Chí Minh",
      dien_thoai: "028 7100 0101",
    },
    patient: {
      ho_ten: "Nguyễn Văn An",
      cccd: "079088001234",
      ngay_sinh: "15/04/1988",
      can_nang_kg: 64,
      gioi_tinh: "Nam",
      ma_bhyt: "DN4790012345",
      noi_thuong_tru: "45 Đường Lê Văn Việt, Phường Hiệp Phú, TP. Thủ Đức, TP. Hồ Chí Minh",
    },
    diagnoses: [{ ma_icd: "J06.9", ten: "Viêm đường hô hấp trên cấp" }],
    medicines: [
      {
        printed: "Paracetamol 500mg",
        ten_thuoc: "Paracetamol 500mg",
        biet_duoc: "Paracetamol",
        don_vi_tinh: "Viên",
        so_luong: 20,
        usage: "Uống 1 viên khi sốt trên 38,5°C, cách nhau 6 giờ, tối đa 4 viên/ngày",
        cach_dung: "1 viên khi sốt, cách 6 giờ",
      },
      {
        printed: "Hapacol 650 (Paracetamol 650mg)",
        ten_thuoc: "Hapacol 650",
        biet_duoc: "Paracetamol 650mg",
        don_vi_tinh: "Viên",
        so_luong: 10,
        usage: "Uống 1 viên khi đau đầu, nhức mỏi, cách nhau ít nhất 6 giờ",
        cach_dung: "1 viên khi đau, cách 6 giờ",
      },
      {
        printed: "Loratadin 10mg",
        ten_thuoc: "Loratadin 10mg",
        biet_duoc: "Loratadin",
        don_vi_tinh: "Viên",
        so_luong: 10,
        usage: "Tối 1 viên, uống 10 ngày",
        cach_dung: "Tối 1 viên",
      },
      {
        printed: "Acemuc 200 (Acetylcysteine 200mg)",
        ten_thuoc: "Acemuc 200",
        biet_duoc: "Acetylcysteine 200mg",
        don_vi_tinh: "Viên",
        so_luong: 15,
        usage: "Sáng 1 viên, trưa 1 viên, tối 1 viên sau ăn, uống 5 ngày",
        cach_dung: "Sáng 1, trưa 1, tối 1 sau ăn",
      },
      {
        printed: "Vitamin C 500mg",
        ten_thuoc: "Vitamin C 500mg",
        biet_duoc: "Vitamin C",
        don_vi_tinh: "Viên",
        so_luong: 10,
        usage: "Sáng 1 viên sau ăn, uống 10 ngày",
        cach_dung: "Sáng 1 sau ăn",
      },
    ],
    advice: ["Uống nhiều nước ấm, nghỉ ngơi, tránh gió lạnh.", "Tái khám sau 5 ngày nếu còn sốt hoặc ho nhiều."],
    doctor: "BS. Hoàng Thị Mai",
  },
  {
    slug: "da-day",
    facility: {
      ten: "Phòng khám Tiêu hóa An Bình (mẫu)",
      dia_chi: "88 Đường Trần Não, Phường An Khánh, TP. Thủ Đức, TP. Hồ Chí Minh",
      dien_thoai: "028 7200 0202",
    },
    patient: {
      ho_ten: "Trần Thị Bích Ngọc",
      cccd: "079179004321",
      ngay_sinh: "02/09/1979",
      can_nang_kg: 55,
      gioi_tinh: "Nữ",
      ma_bhyt: "GD4790054321",
      noi_thuong_tru: "27 Đường Nguyễn Duy Trinh, Phường Bình Trưng, TP. Thủ Đức, TP. Hồ Chí Minh",
    },
    diagnoses: [{ ma_icd: "K29.7", ten: "Viêm dạ dày" }],
    medicines: [
      {
        printed: "Nexium Mups 40mg (Esomeprazole)",
        ten_thuoc: "Nexium Mups 40mg",
        biet_duoc: "Esomeprazole",
        don_vi_tinh: "Viên",
        so_luong: 14,
        usage: "Sáng 1 viên trước ăn 30 phút, uống 14 ngày",
        cach_dung: "Sáng 1 trước ăn 30 phút",
      },
      {
        printed: "Domperidon 10mg",
        ten_thuoc: "Domperidon 10mg",
        biet_duoc: "Domperidon",
        don_vi_tinh: "Viên",
        so_luong: 21,
        usage: "Sáng 1 viên, trưa 1 viên, tối 1 viên trước ăn 15 phút, uống 7 ngày",
        cach_dung: "Sáng 1, trưa 1, tối 1 trước ăn",
      },
      {
        printed: "Smecta (Diosmectite 3g)",
        ten_thuoc: "Smecta",
        biet_duoc: "Diosmectite 3g",
        don_vi_tinh: "Gói",
        so_luong: 20,
        usage: "Sáng 1 gói, tối 1 gói pha với nửa ly nước, uống xa bữa ăn, uống 10 ngày",
        cach_dung: "Sáng 1, tối 1 xa bữa ăn",
      },
      {
        printed: "Gaviscon Dual Action (Natri alginat + Natri bicarbonat + Calci carbonat)",
        ten_thuoc: "Gaviscon Dual Action",
        biet_duoc: "Natri alginat + Natri bicarbonat + Calci carbonat",
        don_vi_tinh: "Gói",
        so_luong: 20,
        usage: "Mỗi lần 1 gói, 4 lần/ngày sau ăn và trước khi ngủ, uống 5 ngày",
        cach_dung: "1 gói x 4 lần/ngày sau ăn",
      },
    ],
    advice: [
      "Ăn chín uống sôi, tránh đồ cay nóng, rượu bia, cà phê.",
      "Tái khám sau 14 ngày hoặc khi đau bụng nhiều, đi ngoài phân đen.",
    ],
    doctor: "BS. Lê Quốc Khánh",
  },
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
        printed: "Metformin 500mg",
        ten_thuoc: "Metformin 500mg",
        biet_duoc: "Metformin",
        don_vi_tinh: "Viên",
        so_luong: 60,
        usage: "Sáng 1 viên, tối 1 viên trong bữa ăn, uống 30 ngày",
        cach_dung: "Sáng 1, tối 1 trong bữa ăn",
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
    ],
    advice: ["Ăn nhạt, hạn chế đường và tinh bột.", "Tái khám sau 30 ngày, mang theo sổ theo dõi."],
    doctor: "BS. Phạm Đức Hùng",
  },
  {
    slug: "tre-em-tieu-chay",
    facility: {
      ten: "Phòng khám Nhi Ánh Dương (mẫu)",
      dia_chi: "34 Đường Phan Văn Trị, Phường 12, Quận Bình Thạnh, TP. Hồ Chí Minh",
      dien_thoai: "028 7400 0404",
    },
    patient: {
      ho_ten: "Võ Minh Khôi",
      cccd: "079223009876",
      ngay_sinh: "14/05/2023",
      can_nang_kg: 14,
      gioi_tinh: "Nam",
      ma_bhyt: "TE4790098765",
      noi_thuong_tru: "18 Đường Bạch Đằng, Phường 2, Quận Tân Bình, TP. Hồ Chí Minh",
      nguoi_dua_tre: "Võ Thị Lan (mẹ)",
    },
    diagnoses: [{ ma_icd: "A09", ten: "Tiêu chảy" }],
    medicines: [
      {
        printed: "Oresol 245 (Natri clorid + Natri citrat + Kali clorid + Glucose)",
        ten_thuoc: "Oresol 245",
        biet_duoc: "Natri clorid + Natri citrat + Kali clorid + Glucose",
        don_vi_tinh: "Gói",
        so_luong: 10,
        usage: "Pha 1 gói với 200ml nước đun sôi để nguội, uống sau mỗi lần đi ngoài",
        cach_dung: "1 gói pha 200ml sau mỗi lần đi ngoài",
      },
      {
        printed: "Enterogermina (Bacillus clausii) 4 tỷ/5ml",
        ten_thuoc: "Enterogermina 4 tỷ/5ml",
        biet_duoc: "Bacillus clausii",
        don_vi_tinh: "Ống",
        so_luong: 10,
        usage: "Sáng 1 ống, chiều 1 ống, uống 5 ngày",
        cach_dung: "Sáng 1, chiều 1",
      },
      {
        printed: "Zinc gluconat 10mg",
        ten_thuoc: "Zinc gluconat 10mg",
        biet_duoc: "Zinc gluconat",
        don_vi_tinh: "Gói",
        so_luong: 10,
        usage: "Sáng 1 gói hòa với nước, uống 10 ngày",
        cach_dung: "Sáng 1 gói",
      },
      {
        printed: "Paracetamol 250mg",
        ten_thuoc: "Paracetamol 250mg",
        biet_duoc: "Paracetamol",
        don_vi_tinh: "Gói",
        so_luong: 6,
        usage: "Uống 1 gói khi sốt trên 38,5°C, cách nhau 6 giờ",
        cach_dung: "1 gói khi sốt, cách 6 giờ",
      },
    ],
    advice: [
      "Cho trẻ ăn lỏng, bú mẹ và uống nhiều nước.",
      "Tái khám ngay nếu trẻ sốt cao, nôn nhiều hoặc đi ngoài ra máu.",
    ],
    doctor: "BS. Đỗ Thanh Tâm",
  },
  {
    slug: "khang-sinh-ho",
    facility: {
      ten: "Phòng khám Hô hấp Bình Minh (mẫu)",
      dia_chi: "210 Đường Cách Mạng Tháng Tám, Phường 10, Quận 3, TP. Hồ Chí Minh",
      dien_thoai: "028 7500 0505",
    },
    patient: {
      ho_ten: "Đặng Quốc Bảo",
      cccd: "079094005566",
      ngay_sinh: "08/07/1994",
      can_nang_kg: 70,
      gioi_tinh: "Nam",
      ma_bhyt: "CN4790055667",
      noi_thuong_tru: "9 Đường Võ Văn Tần, Phường 6, Quận 3, TP. Hồ Chí Minh",
    },
    diagnoses: [{ ma_icd: "J20", ten: "Viêm phế quản cấp" }],
    medicines: [
      {
        printed: "Augmentin 625mg (Amoxicillin + Acid clavulanic)",
        ten_thuoc: "Augmentin 625mg",
        biet_duoc: "Amoxicillin + Acid clavulanic",
        don_vi_tinh: "Viên",
        so_luong: 14,
        usage: "Sáng 1 viên, chiều 1 viên sau ăn, uống 7 ngày",
        cach_dung: "Sáng 1, chiều 1 sau ăn",
      },
      {
        printed: "Amoxicillin 500mg",
        ten_thuoc: "Amoxicillin 500mg",
        biet_duoc: "Amoxicillin",
        don_vi_tinh: "Viên",
        so_luong: 21,
        usage: "Sáng 1 viên, trưa 1 viên, tối 1 viên sau ăn, uống 7 ngày",
        cach_dung: "Sáng 1, trưa 1, tối 1 sau ăn",
      },
      {
        printed: "Ambroxol 30mg",
        ten_thuoc: "Ambroxol 30mg",
        biet_duoc: "Ambroxol",
        don_vi_tinh: "Viên",
        so_luong: 20,
        usage: "Sáng 1 viên, tối 1 viên sau ăn, uống 10 ngày",
        cach_dung: "Sáng 1, tối 1 sau ăn",
      },
      {
        printed: "Dextromethorphan 15mg",
        ten_thuoc: "Dextromethorphan 15mg",
        biet_duoc: "Dextromethorphan",
        don_vi_tinh: "Viên",
        so_luong: 12,
        usage: "Mỗi lần 1 viên khi ho khan, ngày 3 lần, uống 4 ngày",
        cach_dung: "1 viên x 3 lần/ngày khi ho khan",
      },
    ],
    advice: ["Uống đủ liều kháng sinh, không tự ý ngưng thuốc.", "Tái khám sau 7 ngày hoặc khi khó thở, sốt cao."],
    doctor: "BS. Ngô Thị Thanh Hà",
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
  if (patient.nguoi_dua_tre) {
    y = field(MARGIN, y, "Họ và tên người đưa trẻ đến khám bệnh:", patient.nguoi_dua_tre, 70) + 6;
  }
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
