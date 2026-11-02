import {
  createAccessTokenSigner,
  createAccessTokenVerifier,
  generateAccessTokenKey,
  type AccessTokenInput,
  type AccessTokenSigner,
  type AccessTokenVerifier,
} from "@pharmacy/auth";

export interface TestAccessTokens {
  signer: AccessTokenSigner;
  verifier: AccessTokenVerifier;
  /** A `Bearer <jwt>` header value for the given identity. */
  bearer: (input?: Partial<AccessTokenInput>, now?: Date) => Promise<string>;
}

export const testActorId = "00000000-0000-4000-8000-000000000001";

/** A signer with a throwaway ES256 key and a verifier that trusts exactly that key. */
export const createTestAccessTokens = async (): Promise<TestAccessTokens> => {
  const key = await generateAccessTokenKey("test-key");
  const signer = await createAccessTokenSigner({
    privateKeyPem: key.privateKeyPem,
    keyId: key.keyId,
    publicJwk: key.publicJwk,
  });
  const verifier = createAccessTokenVerifier({ jwks: signer.jwks() });
  return {
    signer,
    verifier,
    bearer: async (input = {}, now) => {
      const { token } = await signer.sign(
        {
          actorId: testActorId,
          actorType: "employee",
          roles: ["Pharmacist"],
          siteIds: [],
          ...input,
        },
        now,
      );
      return `Bearer ${token}`;
    },
  };
};
