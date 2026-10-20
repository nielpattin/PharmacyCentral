import { aiProviders, type AiProviderId } from "../contracts/credentials.ts";

export type AiProviderSettings = { provider: AiProviderId; model: string; baseUrl: string; apiKey: string };

type Environment = Readonly<Record<string, string | undefined>>;

/** The env prefix a purpose reads its settings from: `prescription-reader` -> `AI_PRESCRIPTION_READER`. */
export const aiEnvPrefix = (purpose: string): string => `AI_${purpose.toUpperCase().replaceAll("-", "_")}`;

export const readAiProviderSettings = (purpose: string, env: Environment): AiProviderSettings | undefined => {
  const prefix = aiEnvPrefix(purpose);
  const providerName = `${prefix}_PROVIDER`;
  const modelName = `${prefix}_MODEL`;
  const baseUrlName = `${prefix}_BASE_URL`;
  const apiKeyName = `${prefix}_API_KEY`;
  const trimmed = (name: string): string | undefined => env[name]?.trim() || undefined;

  const provider = trimmed(providerName);
  const model = trimmed(modelName);
  const baseUrl = trimmed(baseUrlName);
  const apiKey = trimmed(apiKeyName);
  if (provider === undefined || model === undefined || baseUrl === undefined || apiKey === undefined) {
    const missing = [providerName, modelName, baseUrlName, apiKeyName].filter((name) => trimmed(name) === undefined);
    if (missing.length === 4) return undefined;
    throw new Error(
      `Incomplete AI settings for ${purpose}: set ${missing.join(", ")} or leave all four ${prefix}_* unset.`,
    );
  }

  const providerId = aiProviders.find((id) => id === provider);
  if (!providerId) {
    throw new Error(`${providerName} is "${provider}", which has no adapter. Supported: ${aiProviders.join(", ")}.`);
  }
  return { provider: providerId, model, baseUrl, apiKey };
};
