import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Alert, Button, Card, Field as UiField, Select, StatusBadge, useToast, type ToastApi } from "@pharmacy/ui";
import { useRef, type ReactNode } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { PageActions } from "../../components/page-actions.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import type { ListDefaults } from "../../lib/list-url-state.ts";
import { type JsonRecord } from "../../staff-api.ts";
import { bulkMessage, runEach, summarizeBulk, type BulkOutcome, type BulkTemplates } from "./bulk.ts";
import { ALL_STATUSES, statusTone } from "./status.ts";

/** Rows per request for every paged list in this area. */
export const PAGE_SIZE = 100;

/** Queries that a write changes. Every list in the area is under the first key. */
export const INVENTORY_INVALIDATE: readonly QueryKey[] = [["staff-inventory"], ["staff-references"]];

export const ListError = ({ error }: { error: Error | undefined }): React.JSX.Element | null =>
  error ? <Alert variant="danger">{translateText(error.message)}</Alert> : null;

/** `/` focuses the search box inside the given container. */
export const useFocusSearchHotkey = (root: { readonly current: HTMLElement | null }): void => {
  useHotkey(
    "/",
    (event) => {
      const input = root.current?.querySelector<HTMLInputElement>('input[type="search"]');
      if (input === null || input === undefined) return;
      event.preventDefault();
      input.focus();
    },
    { label: "Focus search" },
  );
};

/** Toolbar row above a paged table: the page's filters, then the saved views menu. */
export const ListToolbar = ({
  pageKey,
  defaults,
  children,
}: {
  pageKey: string;
  defaults: ListDefaults;
  children?: ReactNode;
}): React.JSX.Element => (
  <div className="flex flex-wrap items-end gap-2">
    {children}
    <div className="ms-auto">
      <SavedViewsMenu pageKey={pageKey} defaults={defaults} />
    </div>
  </div>
);

export const StatusFilter = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (status: string) => void;
}): React.JSX.Element => (
  <UiField className="w-48" label={translateText("Status")}>
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value={ALL_STATUSES}>{translateText("All statuses")}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {translateText(option)}
        </option>
      ))}
    </Select>
  </UiField>
);

export const statusBadge = (status: string): React.JSX.Element => (
  <StatusBadge tone={statusTone(status)}>{translateText(status)}</StatusBadge>
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

export const LineCard = ({
  index,
  onRemove,
  children,
}: {
  index: number;
  onRemove?: (() => void) | undefined;
  children: ReactNode;
}): React.JSX.Element => (
  <Card className="grid gap-3 p-4 sm:col-span-2">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-semibold text-ink">
        {translateText("Line")} {index + 1}
      </p>
      {onRemove ? (
        <Button size="sm" variant="danger-soft" onClick={onRemove}>
          {translateText("Remove line")}
        </Button>
      ) : null}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
  </Card>
);

export const AddLineButton = ({ onAdd }: { onAdd: () => void }): React.JSX.Element => (
  <div className="sm:col-span-2">
    <Button size="sm" variant="outline" onClick={onAdd}>
      {translateText("Add line")}
    </Button>
  </div>
);

/** The "Create" action in the shell header. Pages with a create flow render one. */
export const CreateAction = ({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element => (
  <PageActions>
    <Button size="sm" onClick={onClick}>
      {translateText(label)}
    </Button>
  </PageActions>
);

/**
 * A create or edit form in a side drawer. Leaving with unsaved input asks first, both from the drawer's close control
 * and from in-app navigation. Ctrl/Cmd+S submits the form. The submit button sits in the footer and points at the form
 * by id. Mount this only while the drawer should be open, so the guard and the shortcut are active only then.
 */
export const FormDrawer = ({
  title,
  subtitle,
  formId,
  submitLabel,
  isDirty,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  formId: string;
  submitLabel: string;
  isDirty: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element => {
  const confirm = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedChangesGuard(isDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );
  const requestClose = async (): Promise<void> => {
    if (isDirty && !(await confirm({ title: "Discard unsaved changes?", confirmLabel: "Discard", tone: "danger" }))) {
      return;
    }
    onClose();
  };
  return (
    <EntityDrawer
      open
      onClose={() => void requestClose()}
      title={translateText(title)}
      {...(subtitle ? { subtitle: translateText(subtitle) } : {})}
      width="lg"
      details={
        <form
          id={formId}
          ref={formRef}
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
        </form>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => void requestClose()}>
            {translateText("Cancel")}
          </Button>
          <Button type="submit" form={formId}>
            {translateText(submitLabel)}
          </Button>
        </>
      }
    />
  );
};

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
