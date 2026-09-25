import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input } from "@pharmacy/ui";

import { DataTable, type Column } from "../components/data-table.tsx";
import { translateText, translateValidationMessage } from "../i18n.ts";
import { referenceLabel, useStaffReferences, type StaffReferences } from "../hooks/useStaffReferences.ts";
import { csvRows, csvTemplate, templateFileName, type ImportDataset } from "../import-datasets.ts";
import {
  ApiProblemError,
  formatDate,
  formatQuantity,
  readRows,
  request,
  text,
  type ApiProblemIssue,
  type JsonRecord,
} from "../staff-api.ts";

const downloadTemplate = (dataset: ImportDataset): void => {
  // Templates are generated in the browser: the web app never ships master data.
  const blob = new Blob([csvTemplate(dataset)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = templateFileName(dataset);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

type SummaryEntry = { key: string; label: string; value: number };

type ImportOutcome =
  | { status: "imported"; dataset: string; fileName: string; summary: SummaryEntry[] }
  | { status: "failed"; message: string; issues: ApiProblemIssue[] };

// What the staff member reviews before importing: the rows exactly as they sit in the file.
type Preview = { columns: Column[]; rows: JsonRecord[]; keys: string[] };

// What the service stored, read back from the owning list endpoint.
type ReadBack =
  | { state: "loading" }
  | { state: "ready"; dataset: ImportDataset; complete: boolean; rows: JsonRecord[]; missing: string[] }
  | { state: "failed"; message: string };

// Summary keys come from the service; the wording matches the dataset the tab imports.
const summaryLabels: Record<string, string> = {
  sites: "Sites",
  storageLocations: "Storage locations",
  suppliers: "Suppliers",
  products: "Products",
  productUnits: "Product units",
  prices: "Prices",
  created: "Balances created",
  unchanged: "Balances unchanged",
  batchesCreated: "Batches created",
};

// The service reports a row failure as `products.3.sku`, which staff read as a line in their file.
const rowLabel = (path: string): string => {
  const segments = path.split(".");
  const position = segments.findIndex((segment) => /^\d+$/.test(segment));
  const index = position === -1 ? undefined : segments[position];
  if (index === undefined) return path;
  const field = segments.slice(position + 1).join(".");
  return field
    ? `${translateText("Row")} ${Number(index) + 1} · ${field}`
    : `${translateText("Row")} ${Number(index) + 1}`;
};

const summaryEntries = (summary: JsonRecord): SummaryEntry[] =>
  Object.entries(summary)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([key, value]) => ({ key, label: summaryLabels[key] ?? key, value }));

// Stored records are shown the way the other screens show them: ids resolved, dates and statuses formatted.
const verificationColumns = (dataset: ImportDataset, references: StaffReferences): Column[] => {
  const renders: Record<string, (row: JsonRecord) => React.ReactNode> = {
    productId: (row) => referenceLabel(references.products, row.productId, ["sku", "name"]),
    siteId: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
    storageLocationId: (row) => referenceLabel(references.locations, row.storageLocationId, ["code", "name"]),
    expiryDate: (row) => formatDate(row.expiryDate),
    quantityOnHand: (row) => formatQuantity(row.quantityOnHand),
    qualityStatus: (row) => <span className="status-chip">{translateText(text(row.qualityStatus))}</span>,
  };
  return dataset.verification.columns.map((column) => {
    const render = renders[column.key];
    return render ? { ...column, render } : column;
  });
};

export const ImportSection = ({ dataset }: { dataset: ImportDataset }): React.JSX.Element => {
  const [pending, setPending] = useState<{ file: File; payload: JsonRecord; preview: Preview }>();
  const [outcome, setOutcome] = useState<ImportOutcome>();
  const [readBack, setReadBack] = useState<ReadBack>();
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const references = useStaffReferences();

  // Reads the imported records back so staff can confirm what the service stored.
  const readBackImported = async (target: ImportDataset, keys: string[]): Promise<void> => {
    setReadBack({ state: "loading" });
    try {
      const stored = await readRows(target.verification.listPath);
      const rows = stored.map((row) => target.verification.flatten?.(row) ?? row);
      const imported = new Set(keys);
      const storedKeys = new Set(rows.map((row) => text(row[target.verification.key], "")));
      setReadBack({
        state: "ready",
        dataset: target,
        complete: target.verification.complete,
        rows: rows.filter((row) => imported.has(text(row[target.verification.key], ""))),
        missing: target.verification.complete ? keys.filter((key) => !storedKeys.has(key)) : [],
      });
    } catch (reason) {
      setReadBack({
        state: "failed",
        message: reason instanceof Error ? reason.message : "Unable to read the imported records",
      });
    }
  };

  const selectFile = async (file: File | undefined): Promise<void> => {
    setOutcome(undefined);
    setPending(undefined);
    setReadBack(undefined);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setOutcome({ status: "failed", message: "Only CSV import files are supported", issues: [] });
      return;
    }
    try {
      const rows = csvRows(await file.text());
      const headers = Object.keys(rows[0] ?? {});
      setPending({
        file,
        payload: dataset.fromCsv(rows),
        preview: {
          columns: headers.map((header) => ({ key: header, label: header })),
          rows,
          keys: [...new Set(rows.map((row) => row[dataset.verification.keyColumn] ?? "").filter(Boolean))],
        },
      });
    } catch (reason) {
      setOutcome({
        status: "failed",
        message: reason instanceof Error ? reason.message : "Unable to read the import file",
        issues: [],
      });
    }
  };

  const submit = async (): Promise<void> => {
    if (!pending) return;
    const { file, payload, preview } = pending;
    setBusy(true);
    setOutcome(undefined);
    setReadBack(undefined);
    try {
      const result = await request<JsonRecord>(dataset.endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });
      setOutcome({
        status: "imported",
        dataset: dataset.label,
        fileName: file.name,
        summary: summaryEntries((result.summary ?? {}) as JsonRecord),
      });
      setPending(undefined);
      // An import rewrites master data, so every cached read model may be stale.
      void queryClient.invalidateQueries();
      void readBackImported(dataset, preview.keys);
    } catch (reason) {
      setOutcome({
        status: "failed",
        message: reason instanceof Error ? reason.message : "Import failed",
        issues: reason instanceof ApiProblemError ? (reason.problem.errors ?? []) : [],
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h1>{translateText(dataset.label)}</h1>
          <p className="page-subtitle">{translateText("Load master data and stock from CSV.")}</p>
        </div>
      </div>
      {outcome?.status === "failed" ? (
        <div className="mb-3.5">
          <Alert variant="danger" role="alert">
            {translateValidationMessage(outcome.message)}
          </Alert>
          {outcome.issues.length ? (
            <details className="mt-2 rounded-md border border-line bg-surface-soft px-4 py-2.5 text-sm">
              <summary className="cursor-pointer text-muted">
                {translateText("Details")} · {outcome.issues.length}
              </summary>
              <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
                {outcome.issues.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    <span className="font-medium">{rowLabel(issue.path)}</span>
                    <span className="text-muted"> — {translateValidationMessage(issue.message)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {outcome?.status === "imported" ? (
        <div className="mb-3.5">
          <p className="success-note">
            {translateText("Import completed")} · {translateText(outcome.dataset)} · {outcome.fileName}
          </p>
          {outcome.summary.length ? (
            <dl className="dash-grid">
              {outcome.summary.map((entry) => (
                <div className="dash-card" key={entry.key}>
                  <dt>{translateText(entry.label)}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-lg border border-line bg-surface-soft p-4">
        <p className="mb-3 text-sm text-muted">
          {translateText(
            "Download the CSV template, fill it with your own data, then import the file. Sites before storage locations, products before stock.",
          )}
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={() => downloadTemplate(dataset)}>
            {translateText("Download CSV template")}
          </Button>
        </div>
        <Input
          key={`${dataset.id}-${pending?.file.name ?? "empty"}`}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-primary-soft file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary"
          onChange={(event) => void selectFile(event.target.files?.[0])}
        />
        {pending ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink">
              {translateText("Ready to import")}: <span className="font-medium">{pending.file.name}</span>
            </span>
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              {busy ? translateText("Importing...") : translateText("Import now")}
            </Button>
            <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setPending(undefined)}>
              {translateText("Remove")}
            </Button>
          </div>
        ) : null}
      </div>
      {pending ? (
        <div className="mt-6">
          <DataTable rows={pending.preview.rows} columns={pending.preview.columns} />
        </div>
      ) : null}
      {readBack ? (
        <div className="mt-6">
          {readBack.state === "loading" ? (
            <p className="loading-note" role="status">
              {translateText("Loading imported records...")}
            </p>
          ) : null}
          {readBack.state === "failed" ? <p className="notice">{translateText(readBack.message)}</p> : null}
          {readBack.state === "ready" ? (
            <>
              {readBack.complete && readBack.missing.length > 0 ? (
                <p className="notice">
                  {translateText("Rows not found in the system")}: {readBack.missing.join(", ")}
                </p>
              ) : null}
              <DataTable
                rows={readBack.rows}
                columns={verificationColumns(readBack.dataset, references)}
                empty="No stored records matched this file"
              />
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
