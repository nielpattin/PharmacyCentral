// Prints the identity-service access-token signing key as three .env lines. Usage: pnpm run auth:keygen
import { generateKeyPairSync, randomUUID } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).trim();
const { kty, crv, x, y } = publicKey.export({ format: "jwk" });
const escapedPem = privateKeyPem.split(/\r?\n/).join("\\n");

console.log(`ACCESS_TOKEN_PRIVATE_KEY="${escapedPem}"`);
console.log(`ACCESS_TOKEN_PUBLIC_JWK='${JSON.stringify({ kty, crv, x, y })}'`);
console.log(`ACCESS_TOKEN_KEY_ID=${randomUUID()}`);
