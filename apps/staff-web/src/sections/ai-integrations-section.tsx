import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@pharmacy/ui";
import { useRef } from "react";

import { useHotkey } from "../hooks/useHotkey.ts";
import { translateText } from "../i18n.ts";
import { readRows, request, text } from "../staff-api.ts";
import { AiCredentialCard, credentialsQueryKey, type FeatureStatus } from "./ai-integrations/credential-card.tsx";
import { aiFeatures, type CredentialView } from "./ai-integrations/features.ts";
import { AiBudgetPanel } from "./ai-integrations/ai-budget-panel.tsx";

const loadStatuses = async (): Promise<FeatureStatus[]> => {
  const results = await Promise.allSettled(aiFeatures.map((feature) => request<CredentialView>(feature.path)));
  return aiFeatures.map((feature, index) => {
    const result = results[index];
    return { feature, view: result?.status === "fulfilled" ? result.value : undefined };
  });
};

const loadPeople = async (): Promise<Map<string, string>> => {
  const rows = await readRows("/api/admin/users");
  return new Map(rows.map((row) => [text(row.id, ""), text(row.displayName, text(row.email, ""))]));
};

export const AiIntegrationsSection = (): React.JSX.Element => {
  const rootRef = useRef<HTMLElement>(null);
  const statuses = useQuery({ queryKey: credentialsQueryKey, queryFn: loadStatuses });
  const people = useQuery({ queryKey: ["ai-credentials-people"], queryFn: loadPeople });

  // Four independent forms share the page: Ctrl/Cmd+S submits the one that holds focus.
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      const focused = document.activeElement;
      const form = focused instanceof HTMLElement ? focused.closest("form") : null;
      if (form && rootRef.current?.contains(form)) form.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

  return (
    <section ref={rootRef} className="grid gap-4">
      <p className="text-sm text-muted">
        {translateText(
          "Provider, model, and API key for the AI features. A saved key is encrypted and never shown again.",
        )}
      </p>
      {statuses.data ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {statuses.data.map((status) => (
            <AiCredentialCard key={status.feature.id} status={status} people={people.data} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4" role="status">
          {aiFeatures.map((feature) => (
            <Skeleton key={feature.id} className="h-72" />
          ))}
          <span className="sr-only">{translateText("Loading AI integrations...")}</span>
        </div>
      )}
      <AiBudgetPanel />
    </section>
  );
};
