import type { AiProviderOption, CredentialStatus, CredentialView } from "./features.ts";

// Editable state of one feature's settings. The API key is never loaded: it starts empty and only ever travels out.
export type FormState = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  baseUrlEdited: boolean;
};

export const initialFormState = (view: CredentialView): FormState => {
  const current = view.current;
  if (current.configured) {
    return {
      provider: current.provider,
      model: current.model,
      baseUrl: current.baseUrl,
      apiKey: "",
      baseUrlEdited: false,
    };
  }
  const first = view.providers[0];
  return {
    provider: first?.id ?? "",
    model: "",
    baseUrl: first?.defaultBaseUrl ?? "",
    apiKey: "",
    baseUrlEdited: false,
  };
};

// Changing the provider moves the base URL to the new provider's default, unless the admin has typed their own.
export const nextBaseUrlOnProviderChange = (
  form: FormState,
  provider: string,
  providers: readonly AiProviderOption[],
): string | undefined => {
  const defaultBaseUrl = providers.find((option) => option.id === provider)?.defaultBaseUrl;
  if (defaultBaseUrl === undefined) return undefined;
  return form.baseUrlEdited ? form.baseUrl : defaultBaseUrl;
};

export const isFormDirty = (form: FormState, baseline: FormState): boolean =>
  form.provider !== baseline.provider ||
  form.model !== baseline.model ||
  form.baseUrl !== baseline.baseUrl ||
  form.apiKey.trim() !== "";

// A saved key carries over when the provider stays the same; otherwise a new key of at least 8 characters is required.
export const canSaveForm = (form: FormState, current: CredentialStatus): boolean => {
  const keepsSavedKey = current.configured && current.source === "stored" && current.provider === form.provider;
  return (
    form.model.trim().length > 0 &&
    form.baseUrl.trim().startsWith("https://") &&
    (keepsSavedKey || form.apiKey.trim().length >= 8)
  );
};

export const settingsBody = (form: FormState): Record<string, string> => {
  const apiKey = form.apiKey.trim();
  return {
    provider: form.provider,
    model: form.model.trim(),
    baseUrl: form.baseUrl.trim(),
    ...(apiKey ? { apiKey } : {}),
  };
};
