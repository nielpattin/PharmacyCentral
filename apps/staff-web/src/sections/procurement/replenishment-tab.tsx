import { skipToken, useQuery } from "@tanstack/react-query";
import { Alert, Button, Field, Input, Select, Skeleton } from "@pharmacy/ui";
import { useState } from "react";

import { EmptyState, RefreshButton } from "../../components/forms.tsx";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { formatDateTime, readOne } from "../../staff-api.ts";
import { fillText } from "./bulk-summary.ts";
import {
  parseSuggestionsResponse,
  REPLENISHMENT_SUGGESTIONS_KEY,
  suggestionsPath,
  type SuggestionsRequest,
} from "./replenishment/contract.ts";
import {
  SUGGESTION_PARAM_DEFAULTS,
  SUGGESTION_PARAM_KEYS,
  SUGGESTION_PARAM_RULES,
  parseSuggestionParam,
  readSuggestionParams,
  type SuggestionParamKey,
  type SuggestionParamText,
} from "./replenishment/params.ts";
import { ReplenishmentReview } from "./replenishment/review-table.tsx";

const PARAM_LABELS: Record<SuggestionParamKey, string> = {
  windowDays: "Sales window (days)",
  coverDays: "Cover (days)",
  safetyDays: "Safety stock (days)",
  defaultLeadTimeDays: "Default lead time (days)",
};

/** The URL keys of this tab. Other tabs' keys in the same URL survive every write (see lib/list-url-state.ts). */
const URL_DEFAULTS = { site: "", ...SUGGESTION_PARAM_DEFAULTS };

/**
 * Reorder suggestions for one site: the parameters (kept in the URL), the grouped review and the draft-order action.
 * A parameter input keeps the text being typed; it reaches the URL on blur or Enter once it is a valid whole number, so
 * a half-typed value never reloads the list.
 */
export const ReplenishmentTab = ({ onOpenPurchaseOrders }: { onOpenPurchaseOrders: () => void }): React.JSX.Element => {
  const list = useListUrlState(URL_DEFAULTS);
  const references = useStaffReferences();
  const [drafts, setDrafts] = useState<Partial<SuggestionParamText>>({});
  const [created, setCreated] = useState<string[]>([]);

  const siteOptions = referenceOptions(references.sites, ["code", "name"]);
  // A site the URL names that is not in the staff member's list is dropped; the first site is the default.
  const siteId = siteOptions.some((option) => option.value === list.values.site)
    ? list.values.site
    : (siteOptions[0]?.value ?? "");

  const committed: SuggestionParamText = {
    windowDays: list.values.windowDays,
    coverDays: list.values.coverDays,
    safetyDays: list.values.safetyDays,
    defaultLeadTimeDays: list.values.defaultLeadTimeDays,
  };
  const paramResult = readSuggestionParams(committed);
  const request: SuggestionsRequest | undefined =
    paramResult.ok && siteId !== "" ? { siteId, params: paramResult.params } : undefined;

  const suggestions = useQuery({
    queryKey: [...REPLENISHMENT_SUGGESTIONS_KEY, request ?? null],
    queryFn: request
      ? async () => parseSuggestionsResponse(await readOne<unknown>(suggestionsPath(request)))
      : skipToken,
  });

  const commit = (key: SuggestionParamKey): void => {
    const draft = drafts[key];
    if (draft === undefined || parseSuggestionParam(key, draft) === undefined) return;
    const next = { ...drafts };
    delete next[key];
    setDrafts(next);
    if (draft.trim() !== list.values[key]) list.setValues({ [key]: draft.trim() }, { history: "replace" });
  };

  const data = suggestions.data;
  let content: React.JSX.Element;
  if (references.loading) {
    content = <Skeleton className="h-64" />;
  } else if (siteId === "") {
    content = <EmptyState>No sites are assigned to you.</EmptyState>;
  } else if (!paramResult.ok) {
    content = <Alert variant="danger">{translateText("Fix the highlighted fields to load suggestions.")}</Alert>;
  } else if (suggestions.isError) {
    const message = suggestions.error instanceof Error ? suggestions.error.message : "The request failed.";
    content = <Alert variant="danger">{translateText(message)}</Alert>;
  } else if (data === undefined) {
    content = <Skeleton className="h-64" />;
  } else if (data.suggestions.length === 0) {
    content = <EmptyState>No products need replenishment</EmptyState>;
  } else {
    content = (
      <>
        <p className="text-xs text-muted">
          {translateText("Updated at")}: {formatDateTime(data.generatedAt)}
        </p>
        <ReplenishmentReview
          key={JSON.stringify(request)}
          siteId={data.siteId}
          rows={data.suggestions}
          suppliers={references.suppliers}
          onCreated={setCreated}
        />
      </>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        {translateText(
          "Suggested quantities from sales speed, stock and lead time. Select lines and create draft orders. Another person approves each draft.",
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Field label={translateText("Site")}>
          <Select
            value={siteId}
            onChange={(event) => list.setValues({ site: event.target.value }, { history: "push" })}
          >
            {siteOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {SUGGESTION_PARAM_KEYS.map((key) => {
          const value = drafts[key] ?? list.values[key];
          const rule = SUGGESTION_PARAM_RULES[key];
          const valid = parseSuggestionParam(key, value) !== undefined;
          return (
            <Field
              key={key}
              label={translateText(PARAM_LABELS[key])}
              hint={
                valid
                  ? undefined
                  : fillText(translateText("Enter a whole number from {min} to {max}."), {
                      min: rule.min,
                      max: rule.max,
                    })
              }
            >
              <Input
                type="number"
                inputMode="numeric"
                min={rule.min}
                max={rule.max}
                step={1}
                value={value}
                aria-invalid={!valid}
                onChange={(event) => setDrafts({ ...drafts, [key]: event.target.value })}
                onBlur={() => commit(key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit(key);
                }}
              />
            </Field>
          );
        })}
      </div>
      <div className="flex justify-end">
        <RefreshButton onClick={() => void suggestions.refetch()} />
      </div>
      {references.error ? <Alert variant="danger">{translateText(references.error)}</Alert> : null}
      {created.length > 0 ? (
        <Alert variant="success" className="flex flex-wrap items-center gap-3">
          <span>
            {fillText(translateText("Created {count} draft purchase orders: {numbers}."), {
              count: created.length,
              numbers: created.join(", "),
            })}
          </span>
          <span>{translateText("Another person must approve each draft before goods can be received.")}</span>
          <Button variant="outline" size="sm" onClick={onOpenPurchaseOrders}>
            {translateText("Open purchase orders")}
          </Button>
        </Alert>
      ) : null}
      {content}
    </div>
  );
};
