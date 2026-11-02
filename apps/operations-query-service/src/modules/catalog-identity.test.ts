import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { callerAuthorization } from "./catalog-identity.ts";

const requestWith = (headers: Record<string, string>): Request =>
  ({ header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

describe("callerAuthorization", () => {
  it("forwards the access token of the employee who asked", () => {
    expect(callerAuthorization(requestWith({ authorization: "Bearer employee-token" }))).toBe("Bearer employee-token");
  });

  it("refuses a catalog read that has no caller to act for", () => {
    expect(() => callerAuthorization(requestWith({ "x-actor-type": "system" }))).toThrow("employee who asked");
  });
});
