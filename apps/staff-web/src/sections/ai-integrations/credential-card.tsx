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
import { useState } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { formatDateTime } from "../../staff-api.ts";
import {
  canSaveForm,
  initialFormState,
  isFormDirty,
  nextBaseUrlOnProviderChange,
  settingsBody,
  type FormState,
} from "./credential-form.ts";
import { fallbackKeyHint, providerKeyHints, type AiFeature, type CredentialView } from "./features.ts";

export const credentialsQueryKey = ["ai-credentials"] as const;

// `view` is undefined when the feature's status could not be loaded.
export type FeatureStatus = { feature: AiFeature; view: CredentialView | undefined };

const sourceBadges = {
  stored: { label: "Saved key", variant: "primary" },
  environment: { label: "Environment key", variant: "outline" },
} as const;

const LoadedCredentialForm = ({ feature, view }: { feature: AiFeature; view: CredentialView }): React.JSX.Element => {
  const [baseline, setBaseline] = useState<FormState>(() => initialFormState(view));
  const [form, setForm] = useState<FormState>(baseline);
  const run = useStaffAction();
  const confirm = useConfirm();
  const current = view.current;
  const stored = current.configured && current.source === "stored" ? current : undefined;
  const canKeepKey = stored !== undefined && stored.provider === form.provider;
  const baseUrlValid = form.baseUrl.trim().startsWith("https://");
  const dirty = isFormDirty(form, baseline);
  useUnsavedChangesGuard(dirty, "Your changes have not been saved.");

  const update = (patch: Partial<FormState>): void => setForm((previous) => ({ ...previous, ...patch }));

  const save = async (): Promise<void> => {
    // A typed key over a configured one replaces it, which cannot be undone here, so the admin types the last 4 characters.
    if (current.configured && form.apiKey.trim() !== "") {
      const accepted = await confirm({
        title: "Replace the API key?",
        description: "The new key replaces the current key. The old key cannot be recovered here.",
        typeToConfirm: current.last4,
        confirmLabel: "Replace key",
        tone: "danger",
      });
      if (!accepted) return;
    }
    const saved = await run({
      path: feature.path,
      method: "PUT",
      body: settingsBody(form),
      invalidate: [credentialsQueryKey],
      success: "Settings saved.",
    });
    if (saved) {
      const cleared = { ...form, apiKey: "" };
      setBaseline(cleared);
      setForm(cleared);
    }
  };

  const remove = async (): Promise<void> => {
    if (stored === undefined) return;
    const accepted = await confirm({
      title: "Remove the API key?",
      description: stored.environmentFallback
        ? "The feature goes back to the key set in the environment."
        : "The feature stops working until a new key is saved.",
      typeToConfirm: stored.last4,
      confirmLabel: "Remove key",
      tone: "danger",
    });
    if (!accepted) return;
    await run({ path: feature.path, method: "DELETE", invalidate: [credentialsQueryKey], success: "API key removed." });
  };

  const keyHint = providerKeyHints[form.provider] ?? fallbackKeyHint;

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
            const baseUrl = nextBaseUrlOnProviderChange(form, provider, view.providers);
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
          <Button type="button" variant="danger-soft" onClick={() => void remove()}>
            {translateText("Remove key")}
          </Button>
        ) : null}
        <Button type="submit" disabled={!canSaveForm(form, current)}>
          {translateText("Save settings")}
        </Button>
      </div>
    </form>
  );
};

export const AiCredentialCard = ({
  status,
  people,
}: {
  status: FeatureStatus;
  people: Map<string, string> | undefined;
}): React.JSX.Element => {
  const { feature, view } = status;
  const savedProvider = view !== undefined && view.current.configured ? view.current.provider : undefined;
  const providerLabel = view?.providers.find((option) => option.id === savedProvider)?.label ?? savedProvider ?? "";
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
            <dd>{providerLabel}</dd>
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
        {view !== undefined ? <LoadedCredentialForm feature={feature} view={view} /> : null}
      </CardContent>
    </Card>
  );
};
