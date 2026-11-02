import { describe, expect, it } from "vitest";

import { createAccessTokenSigner, createAccessTokenVerifier, generateAccessTokenKey } from "./access-token.ts";
import { bearerToken } from "./bearer.ts";

const input = {
  actorId: "user-1",
  actorType: "employee",
  roles: ["Pharmacist"],
  siteIds: ["site-1"],
};

async function setup(ttlSeconds?: number) {
  const key = await generateAccessTokenKey("k1");
  const signer = await createAccessTokenSigner({ ...key, ...(ttlSeconds ? { ttlSeconds } : {}) });
  return { signer, verifier: createAccessTokenVerifier({ jwks: signer.jwks() }) };
}

describe("access tokens", () => {
  it("round-trips the identity", async () => {
    const { signer, verifier } = await setup();
    const { token } = await signer.sign(input);
    expect(await verifier.verify(token)).toMatchObject({ ...input, passwordChangeRequired: false });
  });

  it("carries the password-change flag", async () => {
    const { signer, verifier } = await setup();
    const { token } = await signer.sign({ ...input, passwordChangeRequired: true });
    expect((await verifier.verify(token))?.passwordChangeRequired).toBe(true);
  });

  it("rejects an expired token", async () => {
    const { signer, verifier } = await setup(60);
    const { token } = await signer.sign(input, new Date("2026-01-01T00:00:00Z"));
    expect(await verifier.verify(token, new Date("2026-01-01T00:02:00Z"))).toBeUndefined();
  });

  it("rejects a token signed by another key", async () => {
    const { signer } = await setup();
    const other = await setup();
    const { token } = await signer.sign(input);
    expect(await other.verifier.verify(token)).toBeUndefined();
  });

  it("rejects a tampered payload, a wrong audience and garbage", async () => {
    const { signer, verifier } = await setup();
    const { token } = await signer.sign(input);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", exp: 9999999999, iat: 1, jti: "x" })).toString(
      "base64url",
    );
    expect(await verifier.verify(`${header}.${forged}.${signature}`)).toBeUndefined();
    expect(await verifier.verify("not-a-token")).toBeUndefined();
    expect(await verifier.verify(undefined)).toBeUndefined();
    const key = await generateAccessTokenKey("k1");
    const otherAudience = await createAccessTokenSigner({ ...key, audience: "someone-else" });
    const strict = createAccessTokenVerifier({ jwks: otherAudience.jwks() });
    expect(await strict.verify((await otherAudience.sign(input)).token)).toBeUndefined();
  });
});

describe("bearerToken", () => {
  it("reads only the Bearer scheme", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});
