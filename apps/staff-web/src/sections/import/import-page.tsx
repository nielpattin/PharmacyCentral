import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, StatTile } from "@pharmacy/ui";
import { useState } from "react";

import { useSession } from "../../auth.ts";
import { useConfirm } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { GatedButton } from "../../components/gated-button.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { referenceLabel, useStaffReferences, type StaffReferences } from "../../hooks/useStaffReferences.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText, translateValidationMessage } from "../../i18n.ts";
import { csvRows, csvTemplate, templateFileName, type CsvRow, type ImportDataset } from "../../import-datasets.ts";
import { can } from "../../permissions/staff-permissions.ts";
import {
  ApiProblemError,
  formatDate,
  formatQuantity,
  text,
  writeJson,
  type ApiProblemIssue,
  type JsonRecord,
} from "../../staff-api.ts";
import { parseIssuePath, summaryEntries, type SummaryEntry } from "./import-result.ts";
import { readAllRows } from "./read-back.ts";

// Labels for the step counts the service reports. Unknown keys show as they came.
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

type Preview = { columns: Column[]; rows: CsvRow[]; keys: string[] };

// The file staff picked, parsed in the browser, waiting for "Import now".
type Selected = { file: File; payload: JsonRecord; preview: Preview };

type Result =
  | { status: "imported"; fileName: string; summary: SummaryEntry[] }
  | { status: "failed"; message: string; issues: ApiProblemIssue[] };

// What the service stored, read back from the owning list endpoint.
type ReadBack =
  | { state: "loading" }
  | { state: "ready"; rows: JsonRecord[]; missing: string[] }
  | { state: "failed"; message: string };

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

// Stored records are shown the way the other screens show them: ids resolved, dates and quantities formatted.
const verificationColumns = (dataset: ImportDataset, references: StaffReferences): Column[] => {
  const renders: Record<string, (row: JsonRecord) => React.ReactNode> = {
    productId: (row) => referenceLabel(references.products, row.productId, ["sku", "name"]),
    siteId: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
    storageLocationId: (row) => referenceLabel(references.locations, row.storageLocationId, ["code", "name"]),
    expiryDate: (row) => formatDate(row.expiryDate),
    quantityOnHand: (row) => formatQuantity(row.quantityOnHand),
  };
  return dataset.verification.columns.map((column) => {
    const render = renders[column.key];
    return render ? { ...column, render } : column;
  });
};

const ImportErrors = ({ issues, fileBase }: { issues: ApiProblemIssue[]; fileBase: string }): React.JSX.Element => {
  const rows = issues.map((issue, index) => {
    const location = parseIssuePath(issue.path);
    return {
      id: String(index),
      row: location.row ?? "",
      field: location.field,
      message: translateValidationMessage(issue.message),
      path: issue.path,
    };
  });
  const columns: Column[] = [
    { key: "row", label: "Row" },
    { key: "field", label: "Field" },
    { key: "message", label: "Message" },
    { key: "path", label: "Path" },
  ];
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold text-ink">
        {translateText("Import errors")} · {issues.length}
      </h3>
      <DataTable
        storageKey="staff:import:errors"
        rows={rows}
        columns={columns}
        exportCsv={{ filename: `${fileBase}-errors.csv` }}
      />
    </section>
  );
};

/**
 * One import dataset: pick a CSV, review it, confirm, import in one transaction, then read the stored records back.
 * The import is synchronous: the answer comes with the request, and a failed row rolls back the whole file.
 */
export const ImportPage = ({ dataset }: { dataset: ImportDataset }): React.JSX.Element => {
  const [selected, setSelected] = useState<Selected>();
  const [result, setResult] = useState<Result>();
  const [readBack, setReadBack] = useState<ReadBack>();
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const references = useStaffReferences();
  const confirm = useConfirm();
  const session = useSession();
  // Opening balances are open to any signed-in staff; products, sites, storage locations and suppliers are Pharmacy
  // Manager writes on the edge (POST /api/products/imports), so the other roles see the file but not the import.
  const importGate = can(dataset.id === "openingBalances" ? "stock.import" : "catalog.import", session);

  useUnsavedChangesGuard(selected !== undefined && !busy, "The selected file has not been imported.");
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      void submit();
    },
    { label: "Import now", when: selected !== undefined && !busy && importGate.allowed },
  );

  const readBackImported = async (keys: string[]): Promise<void> => {
    setReadBack({ state: "loading" });
    try {
      const stored = (await readAllRows(dataset.verification.listPath)).map(
        (row) => dataset.verification.flatten?.(row) ?? row,
      );
      const storedKeys = new Set(stored.map((row) => text(row[dataset.verification.key], "")));
      const imported = new Set(keys);
      setReadBack({
        state: "ready",
        rows: stored.filter((row) => imported.has(text(row[dataset.verification.key], ""))),
        missing: dataset.verification.complete ? keys.filter((key) => !storedKeys.has(key)) : [],
      });
    } catch (reason) {
      setReadBack({
        state: "failed",
        message: reason instanceof Error ? reason.message : "Unable to read the imported records",
      });
    }
  };

  const selectFile = async (file: File | undefined): Promise<void> => {
    setResult(undefined);
    setSelected(undefined);
    setReadBack(undefined);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setResult({ status: "failed", message: "Only CSV import files are supported", issues: [] });
      return;
    }
    try {
      const rows = csvRows(await file.text());
      const headers = Object.keys(rows[0] ?? {});
      setSelected({
        file,
        payload: dataset.fromCsv(rows),
        preview: {
          columns: headers.map((header) => ({ key: header, label: header })),
          rows,
          keys: [...new Set(rows.map((row) => row[dataset.verification.keyColumn] ?? "").filter(Boolean))],
        },
      });
    } catch (reason) {
      setResult({
        status: "failed",
        message: reason instanceof Error ? reason.message : "Unable to read the import file",
        issues: [],
      });
    }
  };

  const submit = async (): Promise<void> => {
    if (selected === undefined) return;
    const accepted = await confirm({
      title: "Import this file now?",
      description: "The import runs in one transaction: if any row fails, nothing is saved.",
      confirmLabel: "Import now",
    });
    if (!accepted) return;
    const { file, payload, preview } = selected;
    setBusy(true);
    setResult(undefined);
    setReadBack(undefined);
    try {
      const response = await writeJson<JsonRecord>(dataset.endpoint, "POST", payload);
      setResult({
        status: "imported",
        fileName: file.name,
        summary: summaryEntries((response.summary ?? {}) as JsonRecord),
      });
      setSelected(undefined);
      // An import rewrites master data, so every cached read model may be stale.
      void queryClient.invalidateQueries();
      void readBackImported(preview.keys);
    } catch (reason) {
      setResult({
        status: "failed",
        message: reason instanceof Error ? reason.message : "Import failed",
        issues: reason instanceof ApiProblemError ? (reason.problem.errors ?? []) : [],
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted">
        {translateText(
          "The import runs as one transaction when you start it. If any row is invalid, nothing is saved.",
        )}
      </p>

      {result?.status === "failed" ? (
        <div className="grid gap-3">
          <Alert variant="danger">{translateValidationMessage(result.message)}</Alert>
          {result.issues.length > 0 ? <ImportErrors issues={result.issues} fileBase={dataset.fileBase} /> : null}
        </div>
      ) : null}

      {result?.status === "imported" ? (
        <div className="grid gap-3">
          <Alert variant="success">
            {translateText("Import completed")} · {translateText(dataset.label)} · {result.fileName}
          </Alert>
          {result.summary.length > 0 ? (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-ink">{translateText("Result by step")}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
                {result.summary.map((entry) => (
                  <StatTile
                    key={entry.key}
                    label={translateText(summaryLabels[entry.key] ?? entry.key)}
                    value={entry.value}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <section className="grid gap-3 rounded-lg border border-line bg-surface-soft p-4">
        <p className="text-sm text-muted">
          {translateText(
            "Download the CSV template, fill it with your own data, then import the file. Sites before storage locations, products before stock.",
          )}
        </p>
        <div>
          <Button variant="outline" size="sm" onClick={() => downloadTemplate(dataset)}>
            {translateText("Download CSV template")}
          </Button>
        </div>
        <Input
          key={`${dataset.id}-${selected?.file.name ?? "empty"}`}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-primary-soft file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary"
          onChange={(event) => void selectFile(event.target.files?.[0])}
        />
        {selected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink">
              {translateText("Ready to import")}: <span className="font-medium">{selected.file.name}</span>
            </span>
            <GatedButton gate={importGate} disabled={busy} onClick={() => void submit()}>
              {busy ? translateText("Importing...") : translateText("Import now")}
            </GatedButton>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(undefined)}>
              {translateText("Remove")}
            </Button>
          </div>
        ) : null}
      </section>

      {selected ? (
        <section className="grid gap-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
            <StatTile label={translateText("Rows in file")} value={selected.preview.rows.length} />
          </div>
          <DataTable
            storageKey={`staff:import:${dataset.id}:preview`}
            rows={selected.preview.rows}
            columns={selected.preview.columns}
          />
        </section>
      ) : null}

      {readBack ? (
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-ink">{translateText("Stored records")}</h3>
          {readBack.state === "loading" ? (
            <p className="text-sm text-muted" role="status">
              {translateText("Loading imported records...")}
            </p>
          ) : null}
          {readBack.state === "failed" ? <Alert variant="danger">{translateText(readBack.message)}</Alert> : null}
          {readBack.state === "ready" ? (
            <>
              {readBack.missing.length > 0 ? (
                <Alert variant="warning">
                  {translateText("Rows not found in the system")}: {readBack.missing.join(", ")}
                </Alert>
              ) : null}
              <DataTable
                storageKey={`staff:import:${dataset.id}:stored`}
                rows={readBack.rows}
                columns={verificationColumns(dataset, references)}
                empty="No stored records matched this file"
              />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};
