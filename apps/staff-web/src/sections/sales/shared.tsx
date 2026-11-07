import { useRef, useState } from "react";

import { Alert, Input } from "@pharmacy/ui";

import { DataTable } from "../../components/data-table.tsx";
import { SubTabs } from "../../components/forms.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useDebounced } from "../../hooks/useDebounced.ts";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { translateText } from "../../i18n.ts";
import type { ListDefaults } from "../../lib/list-url-state.ts";
import { formatDateTime, text } from "../../staff-api.ts";
import { auditActionLabel } from "../governance/audit-query.ts";
import { getLanguage } from "../../i18n.ts";
import { shortId, type SalesEntityType } from "./rules.ts";

/** The locale money follows on this screen. It matches the one staff-api uses for quantities. */
export const moneyLocale = (): string => (getLanguage() === "vi" ? "vi-VN" : "en-US");

const SEARCH_DELAY_MS = 250;

export type ListToolbarProps = {
  /** Saved views are kept per page under this key. */
  pageKey: string;
  /** The page's URL-held keys, as passed to useListUrlState. */
  defaults: ListDefaults;
  /** The search text held in the URL (`q`). */
  query: string;
  onQueryChange: (query: string) => void;
  /** English; translated here. */
  searchPlaceholder: string;
  statuses: readonly string[];
  status: string;
  onStatusChange: (status: string) => void;
};

/**
 * Toolbar of a server-paged list: status tabs, the search box, and saved views. Typing is debounced into the URL, so the
 * list refetches once the typist pauses. `/` focuses the search box.
 */
export const ListToolbar = ({
  pageKey,
  defaults,
  query,
  onQueryChange,
  searchPlaceholder,
  statuses,
  status,
  onStatusChange,
}: ListToolbarProps): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(query);
  const [synced, setSynced] = useState(query);
  // A query changed from outside (a saved view, Back) replaces the draft. Typing does not, so the draft survives it.
  if (query !== synced) {
    setSynced(query);
    setDraft(query);
  }
  const commit = useDebounced((next: string) => onQueryChange(next), SEARCH_DELAY_MS);
  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      containerRef.current?.querySelector<HTMLInputElement>("input[type='search']")?.focus();
    },
    { label: "Focus search" },
  );

  return (
    <div className="mb-3 grid gap-2">
      <SubTabs tabs={[...statuses]} active={status} onChange={onStatusChange} />
      <div ref={containerRef} className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label={translateText(searchPlaceholder)}
          placeholder={translateText(searchPlaceholder)}
          value={draft}
          className="max-w-sm"
          onChange={(event) => {
            setDraft(event.target.value);
            commit(event.target.value);
          }}
        />
        <div className="ms-auto">
          <SavedViewsMenu pageKey={pageKey} defaults={defaults} />
        </div>
      </div>
    </div>
  );
};

/** One labelled value in a drawer's details. */
export const DetailField = ({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element => (
  <div className="min-w-0">
    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{translateText(label)}</dt>
    <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
  </div>
);

const NIL_ACTOR = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;

/**
 * The person behind an event: the name the audit API resolves, else the id prefix when identity-service has none (a
 * deactivated account). A change with no person behind it (the expiry sweep, the payment webhook) reads System.
 */
const historyActorText = (row: Readonly<Record<string, unknown>>, entityType: string): string => {
  const id = text(row.actorId, "");
  if (id === "" || NIL_ACTOR.test(id)) return translateText("System");
  const name = text(row.actorName, "");
  if (name) return name;
  // An online order is placed by the shopper, and identity-service names employees only.
  if (entityType === "order" && text(row.action, "").startsWith("sales.order.created")) return translateText("Customer");
  return shortId(id);
};

/** A readable action ("Đổi trạng thái đơn hàng"), followed by the status the event set when its payload names one. */
const historyActionText = (row: Readonly<Record<string, unknown>>, entityType: string): string => {
  const label = auditActionLabel(text(row.action, ""), entityType, translateText);
  let status = "";
  try {
    const payload: unknown = JSON.parse(text(row.payload, "{}"));
    if (payload && typeof payload === "object" && "status" in payload) status = text(payload.status, "");
  } catch {
    // A payload that is not JSON adds nothing to the label.
  }
  return status === "" ? label : `${label}: ${translateText(status)}`;
};

/** Audit history of one order, prescription, or consultation: the events the audit log holds for that entity. */
export const SalesAuditHistory = ({
  entityType,
  entityId,
}: {
  entityType: SalesEntityType;
  entityId: string;
}): React.JSX.Element => {
  const history = usePagedList({
    key: ["staff-audit-history"],
    path: "/api/audit/logs",
    params: { entityType, entityId },
    limit: 50,
  });
  return (
    <div className="grid gap-3">
      {history.error ? <Alert variant="danger">{translateText(history.error.message)}</Alert> : null}
      <DataTable
        storageKey="staff:sales:audit-history"
        loading={history.isLoading}
        rows={history.rows}
        empty="No history yet."
        columns={[
          { key: "occurredAt", label: "Occurred", render: (row) => formatDateTime(row.occurredAt) },
          {
            key: "action",
            label: "Action",
            truncate: false,
            render: (row) => historyActionText(row, entityType),
            text: (row) => historyActionText(row, entityType),
          },
          {
            key: "actorId",
            label: "Actor",
            render: (row) => historyActorText(row, entityType),
            text: (row) => historyActorText(row, entityType),
          },
        ]}
        paging={history.paging}
      />
    </div>
  );
};
