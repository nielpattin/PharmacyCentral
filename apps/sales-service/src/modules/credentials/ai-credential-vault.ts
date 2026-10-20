import type { CredentialStatus, ReplaceCredentialRequest } from "../../contracts/credentials.ts";
import type { AiProviderSettings } from "../../infrastructure/ai-provider-config.ts";
import type { CredentialStore, SecretSealer, StoredCredential } from "./credential-store.ts";

export class ApiKeyRequiredError extends Error {
  public constructor() {
    super("An API key is required because no saved key exists for this provider");
    this.name = "ApiKeyRequiredError";
  }
}

export type AiCredentialVaultOptions = {
  store: CredentialStore;
  sealer: SecretSealer;
  purpose: string;
  fallback: AiProviderSettings | undefined;
  cacheMs: number;
  now?: () => number;
};

/**
 * A short-lived copy of the settings. A read takes an epoch before it awaits the store and fills the cache only if no
 * invalidation happened since, so a read that began before a write cannot put the older settings back.
 */
class SettingsCache<T> {
  private entry: { value: T; expiresAt: number } | undefined;
  /** Bumped by every invalidation; a read compares against the value it captured before awaiting the store. */
  public epoch = 0;

  public constructor(private readonly ttlMs: number) {}

  public read(now: number): { value: T } | undefined {
    if (this.entry && this.entry.expiresAt > now) return { value: this.entry.value };
    return undefined;
  }

  public fill(epoch: number, value: T, now: number): void {
    if (epoch !== this.epoch) return;
    this.entry = { value, expiresAt: now + this.ttlMs };
  }

  public invalidate(): void {
    this.epoch += 1;
    this.entry = undefined;
  }
}

export class AiCredentialVault {
  private readonly options: AiCredentialVaultOptions;
  private readonly cache: SettingsCache<AiProviderSettings | undefined>;

  public constructor(options: AiCredentialVaultOptions) {
    this.options = options;
    this.cache = new SettingsCache(options.cacheMs);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  public async current(): Promise<AiProviderSettings | undefined> {
    const hit = this.cache.read(this.now());
    if (hit) return hit.value;
    const epoch = this.cache.epoch;
    const row = await this.options.store.find(this.options.purpose);
    const settings = row
      ? {
          provider: row.provider,
          model: row.model,
          baseUrl: row.baseUrl,
          apiKey: this.options.sealer.open(row.ciphertext, this.options.purpose),
        }
      : this.options.fallback;
    this.cache.fill(epoch, settings, this.now());
    return settings;
  }

  public async status(): Promise<CredentialStatus> {
    const row = await this.options.store.find(this.options.purpose);
    if (row) {
      return {
        configured: true,
        source: "stored",
        provider: row.provider,
        model: row.model,
        baseUrl: row.baseUrl,
        last4: row.last4,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
        environmentFallback: this.options.fallback !== undefined,
      };
    }
    const fallback = this.options.fallback;
    if (fallback) {
      return {
        configured: true,
        source: "environment",
        provider: fallback.provider,
        model: fallback.model,
        baseUrl: fallback.baseUrl,
        last4: fallback.apiKey.slice(-4),
      };
    }
    return { configured: false };
  }

  public async replace(input: ReplaceCredentialRequest, actorId: string): Promise<CredentialStatus> {
    const updatedAt = new Date(this.now());
    const sealed = await this.sealedKey(input);
    const credential: StoredCredential = {
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      ciphertext: sealed.ciphertext,
      last4: sealed.last4,
      updatedBy: actorId,
      updatedAt,
    };
    await this.options.store.save(this.options.purpose, credential);
    this.reset();
    return this.status();
  }

  public async clear(): Promise<void> {
    await this.options.store.remove(this.options.purpose);
    this.reset();
  }

  private reset(): void {
    this.cache.invalidate();
  }

  private async sealedKey(input: ReplaceCredentialRequest): Promise<{ ciphertext: string; last4: string }> {
    if (input.apiKey !== undefined) {
      return {
        ciphertext: this.options.sealer.seal(input.apiKey, this.options.purpose),
        last4: input.apiKey.slice(-4),
      };
    }
    const row = await this.options.store.find(this.options.purpose);
    if (row === undefined || row.provider !== input.provider) throw new ApiKeyRequiredError();
    return { ciphertext: row.ciphertext, last4: row.last4 };
  }
}
