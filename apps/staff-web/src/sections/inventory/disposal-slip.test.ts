import { describe, expect, it } from "vitest";

import { renderDisposalSlipHtml } from "./disposal-slip.ts";

describe("disposal slip", () => {
  it("lists every batch with its quantity and totals them", () => {
    const html = renderDisposalSlipHtml({
      id: "12345678-0000-4000-8000-000000000000",
      site: "Nhà thuốc Quận 4",
      reason: "Hết hạn",
      note: "Tiêu hủy theo biên bản",
      createdAt: "2026-10-30T03:00:00.000Z",
      decidedAt: "2026-10-30T04:00:00.000Z",
      lines: [
        { product: "Paracetamol", batch: "LOT-1", location: "Kệ A", quantity: 2 },
        { product: "Amoxicillin", batch: "LOT-2", location: "Kệ B", quantity: 3.5 },
      ],
    });

    expect(html).toContain("<td>Paracetamol</td>");
    expect(html).toContain("<td>LOT-2</td>");
    expect(html).toContain('<td class="number">3,5</td>');
    expect(html).toContain("Tổng số lượng");
    expect(html).toContain("5,5");
    expect(html).toContain("12345678");
  });

  it("escapes staff text instead of letting it become markup", () => {
    const html = renderDisposalSlipHtml({
      id: "12345678-0000-4000-8000-000000000000",
      site: "<b>Site</b>",
      reason: "Hết hạn",
      note: '<script>alert("x")</script>',
      createdAt: "",
      decidedAt: "",
      lines: [{ product: "A & B", batch: "LOT-1", location: "Kệ A", quantity: 1 }],
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("&lt;b&gt;Site&lt;/b&gt;");
  });
});
