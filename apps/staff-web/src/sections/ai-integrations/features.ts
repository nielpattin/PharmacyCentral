// Mirrors the services' credential contract. staff-web cannot import service code.
export type AiProviderOption = { id: string; label: string; defaultBaseUrl: string };

export type CredentialStatus =
  | { configured: false }
  | {
      configured: true;
      source: "stored";
      provider: string;
      model: string;
      baseUrl: string;
      last4: string;
      updatedAt: string;
      updatedBy: string;
      environmentFallback: boolean;
    }
  | { configured: true; source: "environment"; provider: string; model: string; baseUrl: string; last4: string };

export type CredentialView = { providers: AiProviderOption[]; current: CredentialStatus };

export type AiFeature = {
  id: string;
  title: string;
  description: string;
  withoutKey: string;
  path: string;
  defaultModel?: string;
};

export const aiFeatures: readonly AiFeature[] = [
  {
    id: "assistant",
    title: "Shopping assistant",
    description: "Answers shopper questions on the customer website.",
    withoutKey: "Without a key the assistant cannot answer.",
    path: "/api/chatbot/credential",
  },
  {
    id: "prescription-reader",
    title: "Prescription photo reading",
    description: "Reads the medicines from a photo of a printed prescription.",
    withoutKey: "Without a key photo reading is off. QR intake still works.",
    path: "/api/prescriptions/intake-credential",
  },
  {
    id: "product-search",
    title: "Semantic product search",
    description: "Finds products by meaning, not only by the exact words typed.",
    withoutKey: "Without a key search matches keywords only.",
    path: "/api/products/search-credential",
  },
  {
    id: "intent-gate",
    title: "Question screening",
    description:
      "Checks each shopper question before the assistant answers. It sends greetings, off topic questions, emergencies and prompt injection to a fixed reply.",
    withoutKey: "Without a key every question goes straight to the assistant.",
    path: "/api/chatbot/intent-gate-credential",
    defaultModel: "jev-latest",
  },
];

// The hint follows the provider the admin picked, because one feature can offer several providers.
export const providerKeyHints: Partial<Record<string, string>> = {
  gemini: "Paste the key from Google AI Studio. It is encrypted when saved.",
  "openai-compatible":
    "Paste the API key of the provider. The base URL ends with its version path, for example https://llm.example.com/v1. It is encrypted when saved.",
  typesafe: "Paste the key from TypeSafe. It is encrypted when saved.",
};

export const fallbackKeyHint = "Paste the API key of the provider. It is encrypted when saved.";
