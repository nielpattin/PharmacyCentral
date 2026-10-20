import type { AiProviderId } from "../../contracts/credentials.ts";
import type { AiProviderSettings } from "../../infrastructure/ai-provider-config.ts";

export type AiAdapters<Port> = Readonly<Record<AiProviderId, (settings: AiProviderSettings) => Port>>;

export const createAdapterSource =
  <Port>(
    settings: () => Promise<AiProviderSettings | undefined>,
    adapters: AiAdapters<Port>,
  ): (() => Promise<Port | undefined>) =>
  async () => {
    const current = await settings();
    return current ? adapters[current.provider](current) : undefined;
  };
