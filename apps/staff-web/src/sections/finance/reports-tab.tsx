import { Alert, DataTable } from "@pharmacy/ui";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { Field } from "../../components/forms.tsx";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { translateText } from "../../i18n.ts";
import { formatDateTime, formatQuantity, text } from "../../staff-api.ts";
import { shortId } from "../procurement/labels.ts";
import { REPORTS_KEY } from "./query-keys.ts";

const LIST_DEFAULTS = { reportType: "sales" } as const;

/**
 * Operational report rows, newest first, for the report type in the URL (`sales` by default, as before). Clearing the
 * field lists every event type. The list pages from the server; export covers the rows loaded so far.
 */
export const ReportsTab = (): React.JSX.Element => {
  const list = useListUrlState(LIST_DEFAULTS);
  const [reportType, setReportType] = useSearchDraft(list.values.reportType, (value) =>
    list.setValues({ reportType: value }),
  );
  const reports = usePagedList({
    key: REPORTS_KEY,
    path: "/api/reports",
    params: { reportType: list.values.reportType || undefined },
    limit: 100,
  });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Field label="Report type" value={reportType} onChange={setReportType} />
        </div>
        <SavedViewsMenu pageKey="finance-reports" defaults={LIST_DEFAULTS} />
      </div>
      {reports.error ? <Alert variant="danger">{translateText(reports.error.message)}</Alert> : null}
      <DataTable
        storageKey="staff:finance:reports"
        labels={dataTableLabels()}
        rows={reports.rows}
        columns={[
          { key: "reportType", label: translateText("Type") },
          {
            key: "subjectId",
            label: translateText("Subject"),
            render: (row) => (row.subjectId ? shortId(row.subjectId) : "-"),
          },
          {
            key: "value",
            label: translateText("Value"),
            align: "right",
            render: (row) => formatQuantity(row.value),
          },
          { key: "occurredAt", label: translateText("Occurred"), render: (row) => formatDateTime(row.occurredAt) },
          {
            key: "payload",
            label: translateText("Details"),
            render: (row) => <code>{text(row.payload)}</code>,
            text: (row) => text(row.payload, ""),
            truncate: 60,
          },
        ]}
        loading={reports.isLoading}
        empty={translateText("No records found")}
        paging={{ hasMore: reports.hasMore, loadingMore: reports.isLoadingMore, onLoadMore: reports.loadMore }}
        exportCsv={{ filename: "reports.csv" }}
      />
    </div>
  );
};
