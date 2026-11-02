import {
  createAccessTokenSigner,
  createAccessTokenVerifier,
  generateAccessTokenKey,
  type AccessTokenInput,
} from "@pharmacy/auth";

const key = await generateAccessTokenKey("test-key");
const signer = await createAccessTokenSigner({
  privateKeyPem: key.privateKeyPem,
  keyId: key.keyId,
  publicJwk: key.publicJwk,
});

/** Verifies the tokens `accessToken` mints, against a local key set. */
export const testAccessTokenVerifier = createAccessTokenVerifier({ jwks: signer.jwks() });

/** An `Authorization` header value carrying a signed access token; the defaults describe a signed-in employee. */
export const accessToken = async (overrides: Partial<AccessTokenInput> = {}, now?: Date): Promise<string> => {
  const { token } = await signer.sign(
    {
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: [],
      siteIds: [],
      ...overrides,
    },
    now,
  );
  return `Bearer ${token}`;
};
