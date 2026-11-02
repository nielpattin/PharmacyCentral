/** The token in an `Authorization: Bearer <token>` header, or undefined for any other shape. */
export function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/i.exec(value.trim());
  return match?.[1];
}
