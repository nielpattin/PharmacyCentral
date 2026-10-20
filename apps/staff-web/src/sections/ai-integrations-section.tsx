import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from "@pharmacy/ui";

import { RefreshButton } from "../components/forms.tsx";
import { useStaffMutation } from "../hooks/useStaffMutation.ts";
import { translateText } from "../i18n.ts";
import { ApiProblemError, formatDateTime, readRows, request, text } from "../staff-api.ts";

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

type KeySource = Extract<CredentialStatus, { configured: true }>["source"];

const sourceBadges: Record<KeySource, { label: string; variant: "primary" | "outline" }> = {
  stored: { label: "Saved key", variant: "primary" },
  environment: { label: "Environment key", variant: "outline" },
};

type AiFeature = {
  id: string;
  title: string;
  description: string;
  withoutKey: string;
  path: string;
  defaultModel?: string;
};

const aiFeatures: readonly AiFeature[] = [
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
const providerKeyHints: Partial<Record<string, string>> = {
  gemini: "Paste the key from Google AI Studio. It is encrypted when saved.",
  "openai-compatible":
    "Paste the API key of the provider. The base URL ends with its version path, for example https://llm.example.com/v1. It is encrypted when saved.",
  typesafe: "Paste the key from TypeSafe. It is encrypted when saved.",
};
const fallbackKeyHint = "Paste the API key of the provider. It is encrypted when saved.";

const credentialsQueryKey = ["ai-credentials"] as const;

type LoadedCredentialView = CredentialView;

type FeatureStatus =
  | { feature: AiFeature; state: "loaded"; view: LoadedCredentialView }
  | { feature: AiFeature; state: "unavailable" };

const loadStatuses = async (): Promise<FeatureStatus[]> => {
  const results = await Promise.allSettled(aiFeatures.map((feature) => request<CredentialView>(feature.path)));
  return aiFeatures.map((feature, index): FeatureStatus => {
    const result = results[index];
    return result?.status === "fulfilled"
      ? { feature, state: "loaded", view: result.value }
      : { feature, state: "unavailable" };
  });
};

const loadPeople = async (): Promise<Map<string, string>> => {
  const rows = await readRows("/api/admin/users");
  return new Map(rows.map((row) => [text(row.id, ""), text(row.displayName, text(row.email, ""))]));
};

type FormState = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  baseUrlEdited: boolean;
};

// Changing the provider moves the base URL to the new provider's default, unless the admin has typed their own.
const nextBaseUrlOnProviderChange = ({
  form,
  provider,
  providers,
}: {
  form: FormState;
  provider: string;
  providers: readonly AiProviderOption[];
}): string | undefined => {
  const defaultBaseUrl = providers.find((option) => option.id === provider)?.defaultBaseUrl;
  if (defaultBaseUrl === undefined) return undefined;
  return form.baseUrlEdited ? form.baseUrl : defaultBaseUrl;
};

const initialFormState = (view: CredentialView): FormState => {
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

type LoadedCredentialFormProps = {
  feature: AiFeature;
  view: LoadedCredentialView;
};

const LoadedCredentialForm = ({ feature, view }: LoadedCredentialFormProps): React.JSX.Element => {
  const [form, setForm] = useState<FormState>(() => initialFormState(view));
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const mutation = useStaffMutation();

  const stored = view.current.configured && view.current.source === "stored" ? view.current : undefined;
  const canKeepKey = stored !== undefined && stored.provider === form.provider;
  const model = form.model.trim();
  const baseUrl = form.baseUrl.trim();
  const apiKey = form.apiKey.trim();
  const baseUrlValid = baseUrl.startsWith("https://");
  const canSave = model.length > 0 && baseUrlValid && (canKeepKey || apiKey.length >= 8) && !mutation.isPending;
  const keyHint = providerKeyHints[form.provider] ?? fallbackKeyHint;

  const update = (patch: Partial<FormState>): void => setForm((previous) => ({ ...previous, ...patch }));

  const save = async (): Promise<void> => {
    try {
      await mutation.mutateAsync({
        path: feature.path,
        method: "PUT",
        body: { provider: form.provider, model, baseUrl, ...(apiKey ? { apiKey } : {}) },
        invalidate: [credentialsQueryKey],
      });
      setError(undefined);
      setMessage("Settings saved.");
      update({ apiKey: "" });
    } catch (reason) {
      setMessage(undefined);
      if (reason instanceof ApiProblemError && reason.problem.code === "api_key_required") {
        setError("This provider has no saved key. Paste an API key to save it.");
        return;
      }
      setError(reason instanceof Error ? reason.message : "Unable to save the settings");
    }
  };

  const remove = async (): Promise<void> => {
    const fallsBack = stored?.environmentFallback === true;
    const warning = fallsBack
      ? "Remove this saved key? The feature goes back to the key set in the environment."
      : "Remove this API key? The feature stops working until a new key is saved.";
    if (!window.confirm(translateText(warning))) return;
    try {
      await mutation.mutateAsync({ path: feature.path, method: "DELETE", invalidate: [credentialsQueryKey] });
      setError(undefined);
      setMessage("API key removed.");
    } catch (reason) {
      setMessage(undefined);
      setError(reason instanceof Error ? reason.message : "Unable to remove the API key");
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field label={translateText("Provider")}>
        <Select
          value={form.provider}
          onChange={(event) => {
            const provider = event.target.value;
            const baseUrl = nextBaseUrlOnProviderChange({ form, provider, providers: view.providers });
            if (baseUrl === undefined) return;
            update({ provider, baseUrl });
          }}
        >
          {view.providers.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={translateText("Model")}
        {...(feature.defaultModel ? { hint: `${translateText("Default model")}: ${feature.defaultModel}` } : {})}
      >
        <Input value={form.model} spellCheck={false} onChange={(event) => update({ model: event.target.value })} />
      </Field>
      <Field
        label={translateText("Base URL")}
        {...(baseUrlValid ? {} : { hint: translateText("Must start with https://") })}
      >
        <Input
          value={form.baseUrl}
          spellCheck={false}
          onChange={(event) => update({ baseUrl: event.target.value, baseUrlEdited: true })}
        />
      </Field>
      <Field
        label={translateText("API key")}
        hint={
          canKeepKey ? translateText("Leave empty to keep the saved key for this provider.") : translateText(keyHint)
        }
      >
        <Input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={form.apiKey}
          onChange={(event) => update({ apiKey: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        {stored ? (
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => void remove()}>
            {translateText("Remove key")}
          </Button>
        ) : null}
        <Button type="submit" disabled={!canSave}>
          {translateText("Save settings")}
        </Button>
      </div>
      {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}
      {message ? <Alert>{translateText(message)}</Alert> : null}
    </form>
  );
};

const AiCredentialCard = ({
  status,
  people,
}: {
  status: FeatureStatus;
  people: Map<string, string> | undefined;
}): React.JSX.Element => {
  const { feature } = status;
  const view = status.state === "loaded" ? status.view : undefined;
  const current = view?.current;
  const currentProviderLabel =
    view !== undefined && current !== undefined && current.configured
      ? (view.providers.find((option) => option.id === current.provider)?.label ?? current.provider)
      : "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>{translateText(feature.title)}</CardTitle>
            <CardDescription>{translateText(feature.description)}</CardDescription>
          </div>
          {view === undefined ? (
            <Badge variant="danger">{translateText("Unavailable")}</Badge>
          ) : view.current.configured ? (
            <Badge variant={sourceBadges[view.current.source].variant}>
              {translateText(sourceBadges[view.current.source].label)}
            </Badge>
          ) : (
            <Badge variant="secondary">{translateText("Not configured")}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view === undefined ? (
          <Alert variant="danger">{translateText("Unable to load the status of this key.")}</Alert>
        ) : view.current.configured ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{translateText("Provider")}</dt>
            <dd>{currentProviderLabel}</dd>
            <dt className="text-muted">{translateText("Model")}</dt>
            <dd>{view.current.model}</dd>
            <dt className="text-muted">{translateText("Base URL")}</dt>
            <dd>{view.current.baseUrl}</dd>
            <dt className="text-muted">{translateText("Key ending in")}</dt>
            <dd>{view.current.last4}</dd>
            {view.current.source === "stored" ? (
              <>
                <dt className="text-muted">{translateText("Updated")}</dt>
                <dd>{formatDateTime(view.current.updatedAt)}</dd>
                <dt className="text-muted">{translateText("Updated by")}</dt>
                <dd>{people?.get(view.current.updatedBy) ?? translateText("Unknown account")}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted">{translateText("Source")}</dt>
                <dd>{translateText("Set in the server environment. A key saved here takes over.")}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-sm text-muted">{translateText(feature.withoutKey)}</p>
        )}
        {status.state === "loaded" ? <LoadedCredentialForm feature={feature} view={status.view} /> : null}
      </CardContent>
    </Card>
  );
};

export const AiIntegrationsSection = (): React.JSX.Element => {
  const statuses = useQuery({ queryKey: credentialsQueryKey, queryFn: loadStatuses });
  const people = useQuery({ queryKey: ["ai-credentials-people"], queryFn: loadPeople });

  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h1>{translateText("AI integrations")}</h1>
          <p className="page-subtitle">
            {translateText(
              "Provider, model, and API key for the AI features. A saved key is encrypted and never shown again.",
            )}
          </p>
        </div>
        <RefreshButton onClick={() => void statuses.refetch()} />
      </div>
      {statuses.data ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {statuses.data.map((status) => (
            <AiCredentialCard key={status.feature.id} status={status} people={people.data} />
          ))}
        </div>
      ) : (
        <p className="loading-note">{translateText("Loading AI integrations...")}</p>
      )}
    </section>
  );
};
