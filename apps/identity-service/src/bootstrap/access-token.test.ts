import { createAccessTokenVerifier, generateAccessTokenKey } from "@pharmacy/auth";
import { describe, expect, it } from "vitest";

import { createAccessTokenSignerFromEnv } from "./access-token.ts";

const key = await generateAccessTokenKey("env-key");
const validEnv = {
  ACCESS_TOKEN_PRIVATE_KEY: key.privateKeyPem,
  ACCESS_TOKEN_PUBLIC_JWK: JSON.stringify(key.publicJwk),
  ACCESS_TOKEN_KEY_ID: key.keyId,
};

describe("access token environment", () => {
  it("builds a signer whose tokens verify against its own key set", async () => {
    const signer = await createAccessTokenSignerFromEnv(validEnv);
    const { token } = await signer.sign({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      roles: [],
      siteIds: [],
    });
    const identity = await createAccessTokenVerifier({ jwks: signer.jwks() }).verify(token);
    expect(identity?.actorId).toBe("00000000-0000-4000-8000-000000000001");
    expect(signer.jwks().keys[0]).toMatchObject({ kid: "env-key", alg: "ES256" });
  });

  it("accepts a private key written with \\n escapes", async () => {
    const escaped = { ...validEnv, ACCESS_TOKEN_PRIVATE_KEY: key.privateKeyPem.replaceAll("\n", "\\n") };
    await expect(createAccessTokenSignerFromEnv(escaped)).resolves.toBeDefined();
  });

  it.each(["ACCESS_TOKEN_PRIVATE_KEY", "ACCESS_TOKEN_PUBLIC_JWK", "ACCESS_TOKEN_KEY_ID"] as const)(
    "fails fast when %s is missing",
    async (name) => {
      await expect(createAccessTokenSignerFromEnv({ ...validEnv, [name]: undefined })).rejects.toThrow(
        `Missing required environment variable: ${name}`,
      );
      await expect(createAccessTokenSignerFromEnv({ ...validEnv, [name]: "" })).rejects.toThrow(name);
    },
  );

  it("fails fast on a public key that is not a JSON object or a private key that is not PEM", async () => {
    await expect(createAccessTokenSignerFromEnv({ ...validEnv, ACCESS_TOKEN_PUBLIC_JWK: "not json" })).rejects.toThrow(
      "ACCESS_TOKEN_PUBLIC_JWK",
    );
    await expect(createAccessTokenSignerFromEnv({ ...validEnv, ACCESS_TOKEN_PUBLIC_JWK: "[]" })).rejects.toThrow(
      "ACCESS_TOKEN_PUBLIC_JWK",
    );
    await expect(createAccessTokenSignerFromEnv({ ...validEnv, ACCESS_TOKEN_PRIVATE_KEY: "garbage" })).rejects.toThrow(
      "ACCESS_TOKEN_PRIVATE_KEY",
    );
  });
});
