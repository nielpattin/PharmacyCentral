/** A printable disposal record (biên bản tiêu hủy) built as a self-contained page, so it prints without app styles. */
export type DisposalSlipLine = {
  product: string;
  batch: string;
  location: string;
  quantity: number;
};

export type DisposalSlipData = {
  id: string;
  site: string;
  reason: string;
  note: string;
  createdAt: string;
  decidedAt: string;
  lines: readonly DisposalSlipLine[];
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const quantityText = (value: number): string =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }).format(value);

const dateText = (value: string): string => {
  if (value === "") return "................";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "................";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "long" }).format(date);
};

/** The document a manager prints and signs after approval. Every value is escaped; the layout carries its own styles. */
export const renderDisposalSlipHtml = (data: DisposalSlipData): string => {
  const rows = data.lines
    .map(
      (line, index) => `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(line.product)}</td>
        <td>${escapeHtml(line.batch)}</td>
        <td>${escapeHtml(line.location)}</td>
        <td class="number">${quantityText(line.quantity)}</td>
      </tr>`,
    )
    .join("");
  const total = data.lines.reduce((sum, line) => sum + line.quantity, 0);
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Biên bản tiêu hủy ${escapeHtml(data.id.slice(0, 8))}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.5; color: #111; }
  h1 { text-align: center; font-size: 18pt; margin: 18px 0 4px; text-transform: uppercase; }
  .nation { text-align: center; margin: 0; }
  .nation strong { display: block; font-size: 14pt; }
  .motto { text-align: center; margin: 0 0 18px; font-weight: bold; }
  h2 { text-align: center; font-size: 16pt; margin: 18px 0 2px; text-transform: uppercase; }
  .meta { text-align: center; font-style: italic; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; }
  th { background: #eee; text-align: center; }
  .number { text-align: right; white-space: nowrap; }
  .total { font-weight: bold; }
  .signatures { display: flex; justify-content: space-between; margin-top: 36px; text-align: center; }
  .signatures div { width: 30%; }
  .signature-space { height: 90px; }
  .note { white-space: pre-wrap; }
</style>
</head>
<body>
  <p class="nation"><strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><span class="motto">Độc lập - Tự do - Hạnh phúc</span></p>
  <h2>Biên bản tiêu hủy hàng hóa</h2>
  <p class="meta">Số: ${escapeHtml(data.id.slice(0, 8).toUpperCase())} · Ngày lập: ${dateText(data.createdAt)}${
    data.decidedAt === "" ? "" : ` · Ngày duyệt: ${dateText(data.decidedAt)}`
  }</p>
  <p><strong>Cơ sở:</strong> ${escapeHtml(data.site)}</p>
  <p><strong>Lý do tiêu hủy:</strong> ${escapeHtml(data.reason)}</p>
  ${data.note === "" ? "" : `<p class="note"><strong>Ghi chú:</strong> ${escapeHtml(data.note)}</p>`}
  <p>Hôm nay, tại cơ sở nêu trên, chúng tôi lập biên bản tiêu hủy các lô hàng hóa sau:</p>
  <table>
    <thead><tr><th>STT</th><th>Sản phẩm</th><th>Số lô</th><th>Vị trí lưu trữ</th><th>Số lượng</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" class="total">Tổng số lượng</td><td class="number total">${quantityText(total)}</td></tr></tfoot>
  </table>
  <p>Biên bản được lập thành 02 bản, mỗi bên giữ 01 bản và có giá trị như nhau.</p>
  <div class="signatures">
    <div><strong>Người lập biên bản</strong><br><em>(Ký, ghi rõ họ tên)</em><div class="signature-space"></div></div>
    <div><strong>Người chứng kiến</strong><br><em>(Ký, ghi rõ họ tên)</em><div class="signature-space"></div></div>
    <div><strong>Người quyết định tiêu hủy</strong><br><em>(Ký, ghi rõ họ tên)</em><div class="signature-space"></div></div>
  </div>
</body>
</html>`;
};

/** Opens the document in its own window and asks the browser to print it. */
export const printDisposalSlip = (data: DisposalSlipData): boolean => {
  const printWindow = window.open("", "_blank", "width=900,height=1000");
  if (!printWindow) return false;
  printWindow.document.write(renderDisposalSlipHtml(data));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
};
