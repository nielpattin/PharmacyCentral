import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SecretBox, SecretBoxError } from "./secret-box.ts";

const masterKey = (): string => randomBytes(32).toString("base64");

describe("SecretBox", () => {
  it("opens what it sealed and never stores the plaintext", () => {
    const box = new SecretBox(masterKey());
    const sealed = box.seal("AIzaSyExampleKey1234", "prescription-reader");

    expect(sealed).not.toContain("AIzaSyExampleKey1234");
    expect(box.open(sealed, "prescription-reader")).toBe("AIzaSyExampleKey1234");
  });

  it("seals the same secret to different values each time", () => {
    const box = new SecretBox(masterKey());

    expect(box.seal("same-secret-value", "prescription-reader")).not.toBe(
      box.seal("same-secret-value", "prescription-reader"),
    );
  });

  it("refuses a sealed value moved to another purpose", () => {
    const box = new SecretBox(masterKey());
    const sealed = box.seal("AIzaSyExampleKey1234", "prescription-reader");

    expect(() => box.open(sealed, "embedding")).toThrow(SecretBoxError);
  });

  it("refuses a value that was altered or sealed under another master key", () => {
    const box = new SecretBox(masterKey());
    const sealed = box.seal("AIzaSyExampleKey1234", "prescription-reader");
    const [format, iv, tag, body] = sealed.split(".") as [string, string, string, string];
    const altered = [format, iv, tag, `${body.slice(0, -2)}${body.endsWith("AA") ? "BB" : "AA"}`].join(".");

    expect(() => box.open(altered, "prescription-reader")).toThrow(SecretBoxError);
    expect(() => new SecretBox(masterKey()).open(sealed, "prescription-reader")).toThrow(SecretBoxError);
  });

  it("rejects a master key that is not 32 bytes", () => {
    expect(() => new SecretBox(randomBytes(16).toString("base64"))).toThrow("32 bytes");
  });

  it("rejects a master key that Buffer.from would decode to 32 bytes but is not strict base64", () => {
    const withInvalidCharacter = `${"A".repeat(42)}!A=`;
    const withoutPadding = "A".repeat(43);

    expect(Buffer.from(withInvalidCharacter, "base64")).toHaveLength(32);
    expect(Buffer.from(withoutPadding, "base64")).toHaveLength(32);
    expect(() => new SecretBox(withInvalidCharacter)).toThrow("32 bytes");
    expect(() => new SecretBox(withoutPadding)).toThrow("32 bytes");
  });

  it("refuses a sealed value whose parts are not strict base64url", () => {
    const box = new SecretBox(masterKey());
    const [format, iv, tag, body] = box.seal("AIzaSyExampleKey1234", "chatbot").split(".") as [
      string,
      string,
      string,
      string,
    ];

    expect(() => box.open([format, `${iv}!`, tag, body].join("."), "chatbot")).toThrow(SecretBoxError);
    expect(() => box.open([format, iv, tag, `${body}=`].join("."), "chatbot")).toThrow(SecretBoxError);
  });
});
