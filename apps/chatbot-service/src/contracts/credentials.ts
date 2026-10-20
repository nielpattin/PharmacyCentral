import { z } from "zod";

export const aiProviders = ["gemini", "openai-compatible", "typesafe"] as const;
export type AiProviderId = (typeof aiProviders)[number];

/** The shape `z.enum` needs: a non-empty list of provider ids. */
export type AiProviderList = readonly [AiProviderId, ...AiProviderId[]];

/**
 * The chat model has adapters for `gemini` and `openai-compatible` (any API that speaks chat completions). `typesafe`
 * (TypeSafe Jev) has an adapter for the intent gate only.
 */
export const chatModelProviders = ["gemini", "openai-compatible"] as const satisfies AiProviderList;
export const intentGateProviders = ["typesafe"] as const satisfies AiProviderList;

export type AiProviderOption = { id: AiProviderId; label: string; defaultBaseUrl: string };

export const aiProviderCatalog: Readonly<Record<AiProviderId, Omit<AiProviderOption, "id">>> = {
  gemini: { label: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com" },
  "openai-compatible": { label: "OpenAI-compatible", defaultBaseUrl: "https://api.openai.com/v1" },
  typesafe: { label: "TypeSafe Jev", defaultBaseUrl: "https://api.typesafe.ai" },
};

/** A feature's PUT body. Only the providers of that feature pass. */
export const replaceCredentialRequestSchema = (providers: AiProviderList) =>
  z.object({
    provider: z.enum(providers),
    model: z.string().trim().min(1).max(128),
    baseUrl: z
      .string()
      .trim()
      .max(512)
      // zod 4 deprecates `z.string().url()`, so this refines with `URL.canParse` instead.
      .refine((value) => URL.canParse(value), "baseUrl must be a URL")
      .refine((value) => value.startsWith("https://"), "baseUrl must use https"),
    apiKey: z.string().trim().min(8).max(512).optional(),
  });
export type ReplaceCredentialRequest = {
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  apiKey?: string | undefined;
};

export type CredentialStatus =
  | { configured: false }
  | {
      configured: true;
      source: "stored";
      provider: AiProviderId;
      model: string;
      baseUrl: string;
      last4: string;
      updatedAt: string;
      updatedBy: string;
      environmentFallback: boolean;
    }
  | {
      configured: true;
      source: "environment";
      provider: AiProviderId;
      model: string;
      baseUrl: string;
      last4: string;
    };

export type CredentialView = { providers: AiProviderOption[]; current: CredentialStatus };
