import type { AiProviderId } from "../../contracts/credentials.ts";
import type { AiProviderSettings } from "../../infrastructure/ai-provider-config.ts";

/** One constructor per provider the feature supports. A feature lists only its own providers. */
export type AiAdapters<Port, Provider extends AiProviderId> = Readonly<
  Record<Provider, (settings: AiProviderSettings) => Port>
>;

const hasAdapter = <Provider extends AiProviderId>(
  adapters: Readonly<Record<Provider, unknown>>,
  provider: AiProviderId,
): provider is Provider => Object.hasOwn(adapters, provider);

export const createAdapterSource =
  <Port, Provider extends AiProviderId>(
    settings: () => Promise<AiProviderSettings | undefined>,
    adapters: AiAdapters<Port, Provider>,
  ): (() => Promise<Port | undefined>) =>
  async () => {
    const current = await settings();
    if (!current) return undefined;
    if (!hasAdapter(adapters, current.provider)) {
      throw new Error(`The ${current.provider} provider has no adapter for this feature`);
    }
    return adapters[current.provider](current);
  };
