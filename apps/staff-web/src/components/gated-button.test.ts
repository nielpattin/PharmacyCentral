import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GatedButton } from "./gated-button.tsx";

describe("GatedButton", () => {
  it("renders the button when the gate allows it", () => {
    const html = renderToStaticMarkup(createElement(GatedButton, { gate: { allowed: true } }, "Approve"));
    expect(html).toContain("<button");
    expect(html).toContain("Approve");
  });

  it("renders nothing when the gate refuses it, whatever the reason", () => {
    const html = renderToStaticMarkup(
      createElement(GatedButton, { gate: { allowed: false, reason: "No access" } }, "Approve"),
    );
    expect(html).toBe("");
  });
});
