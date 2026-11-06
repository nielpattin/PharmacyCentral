import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { renderedText } from "./rendered-text.ts";

describe("renderedText", () => {
  it("returns a string or number as it is", () => {
    expect(renderedText("Đã hủy")).toBe("Đã hủy");
    expect(renderedText(3)).toBe("3");
    expect(renderedText(0)).toBe("0");
  });

  it("gives nothing for null, undefined and booleans", () => {
    expect(renderedText(null)).toBe("");
    expect(renderedText(undefined)).toBe("");
    expect(renderedText(false)).toBe("");
  });

  it("reads the children of an element, however deep", () => {
    const badge = createElement("span", { className: "badge" }, createElement("b", null, "Đã hủy"));
    expect(renderedText(badge)).toBe("Đã hủy");
  });

  it("joins an array of nodes and skips the empty ones", () => {
    expect(renderedText(["#", null, "6845698B"])).toBe("#6845698B");
  });

  it("gives nothing for an element without text", () => {
    expect(renderedText(createElement("svg"))).toBe("");
  });
});
