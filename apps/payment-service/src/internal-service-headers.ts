export const internalServiceHeaders = (actorId?: string): Record<string, string> => {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret)
    throw new Error("Missing required environment variable: INTERNAL_SERVICE_SECRET. Please set it in your .env file.");
  return {
    "x-internal-service-secret": secret,
    ...(actorId ? { "x-actor-id": actorId } : {}),
  };
};
