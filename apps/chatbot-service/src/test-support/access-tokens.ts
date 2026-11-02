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

/** Verifies the tokens `bearerHeaders` mints, against a local key set. */
export const testVerifier = createAccessTokenVerifier({ jwks: signer.jwks() });

export type TestIdentity = Partial<AccessTokenInput> & { actorType: string };

/** An `Authorization` header carrying a real signed access token for the identity. */
export const bearerHeaders = async (identity: TestIdentity, now?: Date): Promise<Record<string, string>> => {
  const { token } = await signer.sign(
    {
      actorId: identity.actorId ?? "00000000-0000-4000-8000-0000000000aa",
      actorType: identity.actorType,
      roles: identity.roles ?? [],
      siteIds: identity.siteIds ?? [],
      ...(identity.passwordChangeRequired ? { passwordChangeRequired: true } : {}),
    },
    now,
  );
  return { authorization: `Bearer ${token}` };
};
