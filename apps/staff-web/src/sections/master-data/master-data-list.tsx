import { useQuery } from "@tanstack/react-query";
import { Alert, Button, RowActions } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { PageActions } from "../../components/page-actions.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useDebounced } from "../../hooks/useDebounced.ts";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { referenceLabel, referenceOptions } from "../../hooks/useStaffReferences.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { idOf, readRows, text, type JsonRecord } from "../../staff-api.ts";
import { sameValues, type MasterDataConfig, type RecordValues } from "./master-data-config.ts";
import { MasterRecordForm } from "./master-record-form.tsx";

const LIST_DEFAULTS = { q: "" } as const;
const SEARCH_DEBOUNCE_MS = 250;

// The record open in the drawer. `baseline` is what was loaded or opened blank, so dirty means "differs from it".
type Editor = { id: string | undefined; code: string; baseline: RecordValues; values: RecordValues };

/**
 * List of one master-data kind. Rows page from the server (cursor, newest order of the catalogue), search runs on
 * the server through the `q` URL param, and create or edit happens in a drawer that keeps the list in place.
 */
export const MasterDataList = ({ config }: { config: MasterDataConfig }): React.JSX.Element => {
  const { values: urlValues, setValues } = useListUrlState(LIST_DEFAULTS);
  const [draft, setDraft] = useState(urlValues.q);
  const [appliedQuery, setAppliedQuery] = useState(urlValues.q);
  // A saved view changes `q` in the URL from outside the search box, so the box follows the URL when it changes.
  if (urlValues.q !== appliedQuery) {
    setAppliedQuery(urlValues.q);
    setDraft(urlValues.q);
  }
  const commitSearch = useDebounced((value: string) => setValues({ q: value }), SEARCH_DEBOUNCE_MS);

  const list = usePagedList({
    key: config.queryKey,
    path: config.listPath,
    params: { q: urlValues.q || undefined },
    limit: 100,
  });
  const sitesQuery = useQuery({
    queryKey: ["master-data", "site-options"],
    queryFn: () => readRows("/api/sites"),
    enabled: config.usesSites,
  });
  const sites = sitesQuery.data ?? [];
  const siteOptions = referenceOptions(sites, ["code", "name"]);

  const [editor, setEditor] = useState<Editor>();
  const dirty = editor !== undefined && !sameValues(editor.values, editor.baseline);
  useUnsavedChangesGuard(dirty, "Your changes have not been saved.");

  const run = useStaffAction();
  const confirm = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const formId = `master-${config.id}-form`;

  const openCreate = (): void => {
    const initial = config.initialValues();
    setEditor({ id: undefined, code: "", baseline: initial, values: initial });
  };

  const openEdit = (row: JsonRecord): void => {
    const values = config.valuesFromRow(row);
    setEditor({ id: text(row.id, ""), code: config.codeOf(row), baseline: values, values });
  };

  const requestClose = async (): Promise<void> => {
    if (dirty) {
      const discard = await confirm({
        title: "Discard changes?",
        description: "Your changes have not been saved.",
        confirmLabel: "Discard",
        tone: "danger",
      });
      if (!discard) return;
    }
    setEditor(undefined);
  };

  const save = async (): Promise<void> => {
    if (editor === undefined) return;
    const saved = await run({
      path: editor.id ? `${config.listPath}/${editor.id}` : config.listPath,
      method: editor.id ? "PUT" : "POST",
      body: config.toBody(editor.values),
      invalidate: [["master-data"], ["staff-references"]],
      success: editor.id ? config.updated : config.created,
    });
    if (saved) setEditor(undefined);
  };

  const remove = async (row: JsonRecord): Promise<void> => {
    const code = config.codeOf(row);
    const accepted = await confirm({
      title: config.deleteTitle,
      typeToConfirm: code || text(row.id, ""),
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!accepted) return;
    await run({
      path: `${config.listPath}/${text(row.id, "")}`,
      method: "DELETE",
      invalidate: [["master-data"], ["staff-references"]],
      success: config.deleted,
    });
  };

  // Shortcuts: "/" focuses the search box, "n" opens create, Ctrl/Cmd+S submits the open drawer's form.
  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      tableRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    },
    { label: "Focus search" },
  );
  useHotkey("n", openCreate, { label: "Create new", when: editor === undefined });
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true, when: editor !== undefined },
  );

  const columns: Column[] = [
    ...config.columns.map((column): Column => {
      const base = { key: column.key, label: column.label, truncate: column.truncate ?? false };
      return column.key === "siteId"
        ? { ...base, render: (row) => referenceLabel(sites, row.siteId, ["code", "name"]) }
        : base;
    }),
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      align: "right",
      width: 170,
      render: (row) => (
        <RowActions label={translateText("Actions")}>
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
            {translateText("Edit")}
          </Button>
          <Button variant="danger-soft" size="sm" onClick={() => void remove(row)}>
            {translateText("Delete")}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageActions>
        <Button size="sm" onClick={openCreate}>
          {translateText(config.createLabel)}
        </Button>
      </PageActions>
      {list.error ? (
        <Alert variant="danger" heading={translateText("Unable to load the list.")}>
          {translateText(list.error.message)}
        </Alert>
      ) : null}
      {sitesQuery.error ? (
        <Alert variant="danger" heading={translateText("Unable to load the list.")}>
          {translateText(sitesQuery.error.message)}
        </Alert>
      ) : null}
      <div ref={tableRef} className="grid gap-3">
        <div className="flex justify-end">
          <SavedViewsMenu pageKey={`master-data-${config.id}`} defaults={LIST_DEFAULTS} />
        </div>
        <DataTable
          storageKey={`staff:master-data:${config.id}`}
          rows={list.rows}
          columns={columns}
          getKey={(row) => idOf(row)}
          loading={list.isLoading}
          search={{
            value: draft,
            onChange: (value) => {
              setDraft(value);
              commitSearch(value);
            },
            placeholder: translateText(config.searchPlaceholder),
          }}
          paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
          exportCsv={{ filename: `${config.id}.csv` }}
        />
      </div>
      <EntityDrawer
        open={editor !== undefined}
        onClose={() => void requestClose()}
        title={translateText(editor?.id ? config.editTitle : config.createLabel)}
        {...(editor?.code ? { subtitle: editor.code } : {})}
        width="lg"
        details={
          editor ? (
            <MasterRecordForm
              id={formId}
              formRef={formRef}
              fields={config.fields}
              values={editor.values}
              siteOptions={siteOptions}
              onChange={(name, value) =>
                setEditor((current) =>
                  current ? { ...current, values: { ...current.values, [name]: value } } : current,
                )
              }
              onSubmit={() => void save()}
            />
          ) : null
        }
        footer={
          <>
            <Button variant="outline" onClick={() => void requestClose()}>
              {translateText("Cancel")}
            </Button>
            <Button type="submit" form={formId}>
              {translateText("Save")}
            </Button>
          </>
        }
      />
    </>
  );
};
