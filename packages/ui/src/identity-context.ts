export const apiServiceForPath = (path: string): string | undefined => {
  const clean = path.split("?")[0] ?? "";
  const segment = clean.startsWith("/api/") ? clean.slice("/api/".length).split("/")[0] : undefined;
  switch (segment) {
    case "sites":
    case "storage-locations":
    case "products":
    case "suppliers":
    case "pricing":
    case "stores":
    case "availability":
      return "catalog-service";
    case "procurement":
    case "inventory":
    case "quality":
      return "inventory-service";
    case "carts":
    case "orders":
    case "delivery":
    case "prescriptions":
    case "counter-transactions":
      return "sales-service";
    case "payments":
      return "payment-service";
    case "operations":
    case "dashboard":
    case "finance":
    case "audit":
    case "reports":
      return "operations-query-service";
    default:
      return undefined;
  }
};

export type IdentityContexts = { contexts: Record<string, string>; expiresAt: string };

export const createIdentityContextCache = (
  fetchContexts: () => Promise<IdentityContexts>,
): {
  tokenFor: (service: string) => Promise<string | undefined>;
  invalidate: () => void;
} => {
  let cached: IdentityContexts | undefined;
  let pending: Promise<IdentityContexts> | undefined;
  const fresh = (): boolean => Boolean(cached) && new Date(cached?.expiresAt ?? 0).getTime() - 30_000 > Date.now();
  return {
    tokenFor: async (service: string): Promise<string | undefined> => {
      if (!fresh()) {
        pending ??= fetchContexts()
          .then((contexts) => {
            cached = contexts;
            return contexts;
          })
          .finally(() => {
            pending = undefined;
          });
        try {
          await pending;
        } catch {
          cached = undefined;
          return undefined;
        }
      }
      return cached?.contexts[service];
    },
    invalidate: (): void => {
      cached = undefined;
    },
  };
};
