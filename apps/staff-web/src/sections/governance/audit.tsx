import { Alert, Button, Field, Input, Select } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useDebounced } from "../../hooks/useDebounced.ts";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { referenceLabel, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { formatDateTime, text } from "../../staff-api.ts";
import {
  AUDIT_DEFAULTS,
  AUDIT_ENTITY_GROUPS,
  auditActionLabel,
  auditEntityLabel,
  auditPayloadText,
  auditRequestParams,
} from "./audit-query.ts";
import { employeeLabel, shortId, toEmployeeAccount } from "./employees.ts";
import { useEmployees } from "./queries.ts";

const SEARCH_DELAY_MS = 250;

/** The audit log: cursor-paged, filtered in the URL, exportable. Rows are read-only. */
export const AuditTab = (): React.JSX.Element => {
  const { values, setValues } = useListUrlState(AUDIT_DEFAULTS);
  // The search box shows what was typed and the URL gets it after a pause. `sent` tells an outside change (a saved
  // view, Back) apart from our own write, so typing is never overwritten by the URL echoing it back.
  const [sent, setSent] = useState(values.q);
  const [draft, setDraft] = useState(values.q);
  if (values.q !== sent) {
    setSent(values.q);
    setDraft(values.q);
  }
  const commitQuery = useDebounced((query: string) => {
    setSent(query);
    setValues({ q: query });
  }, SEARCH_DELAY_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    },
    { label: "Focus search" },
  );

  const audit = usePagedList({
    key: ["governance-audit"],
    path: "/api/audit/logs",
    params: auditRequestParams(values),
    limit: 100,
  });
  const employees = useEmployees();
  const references = useStaffReferences();
  const accounts = (employees.data ?? []).map(toEmployeeAccount);
  const actorNames = new Map(accounts.map((account) => [account.id, employeeLabel(account)]));
  const actorName = (value: unknown): string => {
    const id = text(value, "");
    if (id === "") return "System";
    return actorNames.get(id) ?? shortId(id);
  };

  const columns: Column[] = [
    {
      key: "occurredAt",
      label: "Occurred",
      render: (row) => formatDateTime(row.occurredAt),
      text: (row) => text(row.occurredAt, ""),
    },
    {
      key: "action",
      label: "Action",
      truncate: 32,
      render: (row) => auditActionLabel(text(row.action, ""), text(row.entityType, ""), translateText),
      text: (row) => auditActionLabel(text(row.action, ""), text(row.entityType, ""), translateText),
    },
    {
      key: "entityType",
      label: "Entity",
      render: (row) => {
        const id = text(row.entityId, "");
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {translateText(auditEntityLabel(text(row.entityType, "")))}
            {id ? <code className="font-mono text-xs text-muted">{shortId(id)}</code> : null}
          </span>
        );
      },
      text: (row) => `${auditEntityLabel(text(row.entityType, ""))} ${text(row.entityId, "")}`.trim(),
    },
    {
      key: "actorId",
      label: "Actor",
      render: (row) => translateText(actorName(row.actorId)),
      text: (row) => actorName(row.actorId),
    },
    {
      key: "siteId",
      label: "Site",
      render: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]) || "-",
      text: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]) || "-",
    },
    {
      key: "payload",
      label: "Details",
      truncate: 48,
      enableSorting: false,
      render: (row) => <code className="font-mono text-xs text-muted">{auditPayloadText(row.payload)}</code>,
      text: (row) => auditPayloadText(row.payload),
    },
  ];

  const clearFilters = (): void => {
    commitQuery.cancel();
    setSent("");
    setDraft("");
    setValues({ q: "", entityType: "", actor: "", from: "", to: "" });
  };

  return (
    <div ref={rootRef} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end">
        <Field label={translateText("Entity type")}>
          <Select value={values.entityType} onChange={(event) => setValues({ entityType: event.target.value })}>
            <option value="">{translateText("All entity types")}</option>
            {AUDIT_ENTITY_GROUPS.map((group) => (
              <optgroup key={group.label} label={translateText(group.label)}>
                {group.types.map((item) => (
                  <option key={item.value} value={item.value}>
                    {translateText(item.label)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label={translateText("Actor")}>
          <Select value={values.actor} onChange={(event) => setValues({ actor: event.target.value })}>
            <option value="">{translateText("All actors")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {employeeLabel(account)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={translateText("From")}>
          <Input
            type="date"
            value={values.from}
            max={values.to || undefined}
            onChange={(event) => setValues({ from: event.target.value })}
          />
        </Field>
        <Field label={translateText("To")}>
          <Input
            type="date"
            value={values.to}
            min={values.from || undefined}
            onChange={(event) => setValues({ to: event.target.value })}
          />
        </Field>
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          {translateText("Clear filters")}
        </Button>
      </div>
      {audit.error ? <Alert variant="danger">{translateText(audit.error.message)}</Alert> : null}
      <DataTable
        toolbarExtra={<SavedViewsMenu pageKey="governance-audit" defaults={AUDIT_DEFAULTS} />}
        rows={audit.rows}
        columns={columns}
        getKey={(row, index) => text(row.eventId, String(index))}
        loading={audit.isLoading}
        empty="No audit entries match these filters."
        search={{
          value: draft,
          onChange: (next) => {
            setDraft(next);
            commitQuery(next);
          },
          placeholder: translateText("Search by action, entity ID or actor ID"),
        }}
        paging={audit.paging}
        storageKey="staff:governance:audit"
        exportCsv={{ filename: "audit-log.csv" }}
      />
    </div>
  );
};
