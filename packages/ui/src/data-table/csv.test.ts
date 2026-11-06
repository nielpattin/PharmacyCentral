import { describe, expect, it } from "vitest";

import { CSV_BYTE_ORDER_MARK, toCsv } from "./csv.ts";

type Row = { name: string; qty: number | null; note?: string };

const columns = [
  { label: "Name", value: (row: Row) => row.name },
  { label: "Qty", value: (row: Row) => row.qty },
  { label: "Note", value: (row: Row) => row.note },
];

describe("toCsv", () => {
  it("starts with a UTF-8 byte order mark so Excel reads Vietnamese text correctly", () => {
    const csv = toCsv<Row>([], columns);
    expect(csv.startsWith(CSV_BYTE_ORDER_MARK)).toBe(true);
    expect(csv).toBe(`${CSV_BYTE_ORDER_MARK}Name,Qty,Note\r\n`);
  });

  it("keeps Vietnamese diacritics unchanged", () => {
    const csv = toCsv<Row>([{ name: "Paracetamol 500mg – viên nén", qty: 3 }], columns);
    expect(csv).toContain("Paracetamol 500mg – viên nén,3,\r\n");
  });

  it("quotes fields containing commas, quotes, CR or LF and doubles inner quotes", () => {
    const csv = toCsv<Row>(
      [
        { name: 'Hộp "A", loại 2', qty: 1, note: "line1\nline2" },
        { name: "x\ry", qty: 0 },
      ],
      columns,
    );
    expect(csv).toBe(`${CSV_BYTE_ORDER_MARK}Name,Qty,Note\r\n"Hộp ""A"", loại 2",1,"line1\nline2"\r\n"x\ry",0,\r\n`);
  });

  it("renders null and undefined as empty fields", () => {
    const csv = toCsv<Row>([{ name: "A", qty: null }], columns);
    expect(csv).toBe(`${CSV_BYTE_ORDER_MARK}Name,Qty,Note\r\nA,,\r\n`);
  });

  it("quotes header labels that need quoting", () => {
    const csv = toCsv<Row>([], [{ label: "Giá, VND", value: (row: Row) => row.name }]);
    expect(csv).toBe(`${CSV_BYTE_ORDER_MARK}"Giá, VND"\r\n`);
  });

  it("prefixes string cells that spreadsheets read as formulas, and leaves numbers alone", () => {
    const csv = toCsv<Row>(
      [
        { name: "=SUM(A1)", qty: -5 },
        { name: "+1", qty: 0 },
        { name: "@SUM", qty: 1 },
        { name: "-cmd", qty: 2 },
        { name: "\tTab", qty: 3 },
        { name: "Paracetamol", qty: 4 },
      ],
      columns,
    );
    expect(csv).toBe(
      `${CSV_BYTE_ORDER_MARK}Name,Qty,Note\r\n'=SUM(A1),-5,\r\n'+1,0,\r\n'@SUM,1,\r\n'-cmd,2,\r\n'\tTab,3,\r\nParacetamol,4,\r\n`,
    );
  });

  it("leaves a lone dash alone, since it is the table's empty mark and not a formula", () => {
    expect(toCsv<Row>([{ name: "-", qty: 1 }], columns)).toBe(`${CSV_BYTE_ORDER_MARK}Name,Qty,Note\r\n-,1,\r\n`);
  });
});
