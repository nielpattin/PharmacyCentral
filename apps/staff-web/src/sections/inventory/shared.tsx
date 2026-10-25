import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Alert, Select, StatusCell, useToast, type ToastApi } from "@pharmacy/ui";
import { type ReactNode } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { type JsonRecord } from "../../staff-api.ts";
import { bulkMessage, runEach, summarizeBulk, type BulkOutcome, type BulkTemplates } from "./bulk.ts";
import { ALL_STATUSES, statusTone } from "./status.ts";

/** Rows per request for every paged list in this area. */
export const PAGE_SIZE = 100;

/** Queries that a write changes. Every list in the area is under the first key. */
export const INVENTORY_INVALIDATE: readonly QueryKey[] = [["staff-inventory"], ["staff-references"]];

export const ListError = ({ error }: { error: Error | undefined }): React.JSX.Element | null =>
  error ? <Alert variant="danger">{translateText(error.message)}</Alert> : null;

export const StatusFilter = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (status: string) => void;
}): React.JSX.Element => (
  <Select
    aria-label={translateText("Status")}
    className="w-auto"
    value={value}
    onChange={(event) => onChange(event.target.value)}
  >
    <option value={ALL_STATUSES}>{translateText("All statuses")}</option>
    {options.map((option) => (
      <option key={option} value={option}>
        {translateText(option)}
      </option>
    ))}
  </Select>
);

export const statusBadge = (status: string): React.JSX.Element => (
  <StatusCell tone={statusTone(status)}>{translateText(status)}</StatusCell>
);

export const Fact = ({ label, children }: { label: string; children: ReactNode }): React.JSX.Element => (
  <div className="grid min-w-0 gap-0.5">
    <dt className="text-xs font-medium text-muted">{translateText(label)}</dt>
    <dd className="truncate text-sm text-ink">{children}</dd>
  </div>
);

export const FactList = ({ children }: { children: ReactNode }): React.JSX.Element => (
  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
);

/** One write that asks for confirmation first. Returns true when the write went through. */
type ConfirmedAction = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "default" | undefined;
  path: string;
  /** Sent as the request body. Defaults to `{}`, which the transition routes expect. */
  body?: JsonRecord | undefined;
  success: string;
};

export const useConfirmedAction = (): ((action: ConfirmedAction) => Promise<boolean>) => {
  const confirm = useConfirm();
  const run = useStaffAction();
  return async (action) => {
    const accepted = await confirm({
      title: action.title,
      description: action.description,
      confirmLabel: action.confirmLabel,
      tone: action.tone ?? "default",
    });
    if (!accepted) return false;
    return run({
      path: action.path,
      body: action.body ?? {},
      invalidate: INVENTORY_INVALIDATE,
      success: action.success,
    });
  };
};

/**
 * Sends one write per item and reports one summary toast. Items are sent in order; a failure does not stop the rest.
 * Returns true when every item succeeded.
 */
export const useBulkWrite = (): (<T>(
  items: readonly T[],
  describe: (item: T) => string,
  send: (item: T) => Promise<unknown>,
  templates: BulkTemplates,
) => Promise<boolean>) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (items, describe, send, templates) => {
    const outcomes = await runEach(items, describe, send);
    await Promise.all(INVENTORY_INVALIDATE.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    return reportBulk(toast, outcomes, templates);
  };
};

const reportBulk = (toast: ToastApi, outcomes: readonly BulkOutcome[], templates: BulkTemplates): boolean => {
  const translated: BulkOutcome[] = outcomes.map((outcome) =>
    outcome.error === undefined ? outcome : { label: outcome.label, error: translateText(outcome.error) },
  );
  const message = bulkMessage(summarizeBulk(translated), {
    success: translateText(templates.success),
    partial: translateText(templates.partial),
    failedPrefix: translateText(templates.failedPrefix),
  });
  if (message.tone === "success") {
    toast.success(message.text);
    return true;
  }
  toast.error(message.text);
  return false;
};
