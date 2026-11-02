import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { callerAuthorization } from "./catalog-authorization.ts";

const requestWith = (headers: Record<string, string>): Request =>
  ({ header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

describe("callerAuthorization", () => {
  it("returns the Authorization header the employee sent", () => {
    expect(callerAuthorization(requestWith({ authorization: "Bearer abc.def.ghi" }))).toBe("Bearer abc.def.ghi");
  });

  it("refuses when no employee started the request", () => {
    expect(() => callerAuthorization(requestWith({ "x-actor-type": "system" }))).toThrow("employee who started");
  });
});
