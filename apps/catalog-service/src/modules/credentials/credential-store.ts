import type { AiProviderId } from "../../contracts/credentials.ts";

export type StoredCredential = {
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  ciphertext: string;
  last4: string;
  updatedBy: string;
  updatedAt: Date;
};

export interface CredentialStore {
  find(purpose: string): Promise<StoredCredential | undefined>;
  save(purpose: string, credential: StoredCredential): Promise<void>;
  remove(purpose: string): Promise<void>;
}

export interface SecretSealer {
  seal(plaintext: string, context: string): string;
  open(sealed: string, context: string): string;
}
