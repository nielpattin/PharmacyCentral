import type { CredentialStore, StoredCredential } from "./credential-store.ts";

export const createMemoryCredentialStore = (): CredentialStore & { rows: Map<string, StoredCredential> } => {
  const rows = new Map<string, StoredCredential>();
  return {
    rows,
    find: async (purpose) => rows.get(purpose),
    save: async (purpose, credential) => {
      rows.set(purpose, credential);
    },
    remove: async (purpose) => {
      rows.delete(purpose);
    },
  };
};
