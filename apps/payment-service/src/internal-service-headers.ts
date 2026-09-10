export const internalServiceHeaders = (actorId?: string): Record<string, string> => ({
  "x-internal-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
  ...(actorId ? { "x-actor-id": actorId } : {}),
});
