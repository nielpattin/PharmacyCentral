import { z } from "zod";

export const aiProviders = ["gemini"] as const;
export type AiProviderId = (typeof aiProviders)[number];

export type AiProviderOption = { id: AiProviderId; label: string; defaultBaseUrl: string };

export const aiProviderCatalog: Readonly<Record<AiProviderId, Omit<AiProviderOption, "id">>> = {
  gemini: { label: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com" },
};

export const replaceCredentialRequestSchema = z.object({
  provider: z.enum(aiProviders),
  model: z.string().trim().min(1).max(128),
  baseUrl: z
    .string()
    .trim()
    .max(512)
    // zod 4 deprecates `z.string().url()`, so the check uses `URL.canParse`.
    .refine((value) => URL.canParse(value), "baseUrl must be a URL")
    .refine((value) => value.startsWith("https://"), "baseUrl must use https"),
  apiKey: z.string().trim().min(8).max(512).optional(),
});
export type ReplaceCredentialRequest = z.infer<typeof replaceCredentialRequestSchema>;

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
