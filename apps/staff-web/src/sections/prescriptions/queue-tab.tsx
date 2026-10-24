import { Alert, Button, RowActions, StatusBadge } from "@pharmacy/ui";
import { useState } from "react";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { productLabel, useProductLookup } from "../../hooks/useProductLookup.ts";
import { referenceLabel, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { formatDateTime, formatQuantity, text, type JsonRecord } from "../../staff-api.ts";
import {
  ALL_STATUSES,
  activeStatus,
  canCancelPrescription,
  canCreateInvoice,
  canDispense,
  PRESCRIPTION_STATUSES,
  prescriptionTone,
  queryParam,
  recordList,
  shortId,
  statusParam,
} from "../sales/rules.ts";
import { DetailField, ListToolbar, SalesAuditHistory } from "../sales/shared.tsx";
import { usePrescriptionActions } from "./prescription-actions.ts";

const QUEUE_DEFAULTS = { q: "", status: ALL_STATUSES } as const;

/** The queue of prescriptions for the counter, newest first, with the drawer for one prescription's details and history. */
export const PrescriptionQueueTab = ({
  canOperateCounter,
  onDispense,
}: {
  canOperateCounter: boolean;
  onDispense: (prescriptionId: string) => void;
}): React.JSX.Element => {
  const { values, setValues } = useListUrlState(QUEUE_DEFAULTS);
  const status = activeStatus(values.status, PRESCRIPTION_STATUSES, ALL_STATUSES);
  const queue = usePagedList({
    key: ["staff-prescriptions"],
    path: "/api/prescriptions",
    params: { status: statusParam(status), q: queryParam(values.q) },
    limit: 100,
  });
  const references = useStaffReferences();
  const actions = usePrescriptionActions();
  const [openId, setOpenId] = useState<string>();
  const openRow = queue.rows.find((row) => text(row.id, "") === openId);

  const renderActions = (row: JsonRecord, withView: boolean): React.JSX.Element => {
    const id = text(row.id, "");
    const rowStatus = text(row.status, "");
    return (
      <RowActions label={translateText("Prescription actions")}>
        {withView ? (
          <Button variant="ghost" size="sm" onClick={() => setOpenId(id)}>
            {translateText("View")}
          </Button>
        ) : null}
        {canOperateCounter && canDispense(rowStatus) ? (
          <Button size="sm" onClick={() => onDispense(id)}>
            {translateText("Dispense")}
          </Button>
        ) : null}
        {canOperateCounter && canCreateInvoice(rowStatus) ? (
          <Button variant="secondary" size="sm" onClick={() => void actions.createInvoice(id)}>
            {translateText("Create invoice")}
          </Button>
        ) : null}
        {canOperateCounter && canCancelPrescription(rowStatus) ? (
          <Button variant="danger-soft" size="sm" onClick={() => void actions.cancel(id)}>
            {translateText("Cancel prescription")}
          </Button>
        ) : null}
      </RowActions>
    );
  };

  const columns: Column[] = [
    {
      key: "prescriptionNumber",
      label: "Prescription",
      truncate: true,
      render: (row) => text(row.prescriptionNumber, shortId(row.id)),
    },
    { key: "patientName", label: "Patient", truncate: true },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusBadge tone={prescriptionTone(text(row.status, ""))}>{translateText(text(row.status, "-"))}</StatusBadge>
      ),
    },
    {
      key: "siteId",
      label: "Site",
      truncate: true,
      render: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
    },
    {
      key: "lines",
      label: "Lines",
      align: "right",
      enableSorting: false,
      render: (row) => recordList(row.lines).length,
    },
    { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
    {
      key: "actions",
      label: "Actions",
      enableSorting: false,
      pinned: "right",
      render: (row) => renderActions(row, true),
    },
  ];

  return (
    <div className="grid gap-3">
      <ListToolbar
        pageKey="prescriptions"
        defaults={QUEUE_DEFAULTS}
        query={values.q}
        onQueryChange={(q) => setValues({ q })}
        searchPlaceholder="Search by prescription number, patient name, or phone"
        statuses={PRESCRIPTION_STATUSES}
        status={status}
        onStatusChange={(next) => setValues({ status: next }, { history: "push" })}
      />
      {queue.error ? <Alert variant="danger">{translateText(queue.error.message)}</Alert> : null}
      <DataTable
        storageKey="staff:sales:prescriptions"
        loading={queue.isLoading}
        rows={queue.rows}
        columns={columns}
        paging={{ hasMore: queue.hasMore, loadingMore: queue.isLoadingMore, onLoadMore: queue.loadMore }}
        exportCsv={{ filename: "prescriptions.csv" }}
      />
      <EntityDrawer
        open={openRow !== undefined}
        onClose={() => setOpenId(undefined)}
        title={openRow ? text(openRow.prescriptionNumber, shortId(openRow.id)) : ""}
        subtitle={translateText("Prescription")}
        {...(openRow
          ? {
              status: {
                label: translateText(text(openRow.status, "-")),
                tone: prescriptionTone(text(openRow.status, "")),
              },
            }
          : {})}
        details={openRow ? <PrescriptionDetails row={openRow} /> : null}
        history={openRow ? <SalesAuditHistory entityType="prescription" entityId={text(openRow.id, "")} /> : undefined}
        footer={openRow && canOperateCounter ? renderActions(openRow, false) : undefined}
      />
    </div>
  );
};

const PrescriptionDetails = ({ row }: { row: JsonRecord }): React.JSX.Element => {
  const references = useStaffReferences();
  const lines = recordList(row.lines);
  const products = useProductLookup(lines.map((line) => text(line.productId, "")));
  return (
    <div className="grid gap-5">
      <dl className="grid gap-3 sm:grid-cols-2">
        <DetailField label="Patient" value={text(row.patientName)} />
        <DetailField label="Phone" value={text(row.patientPhone)} />
        <DetailField label="Doctor" value={text(row.doctorName)} />
        <DetailField label="Doctor license" value={text(row.doctorLicense)} />
        <DetailField label="Site" value={referenceLabel(references.sites, row.siteId, ["code", "name"])} />
        <DetailField label="Created" value={formatDateTime(row.createdAt)} />
        <DetailField label="Notes" value={text(row.notes)} />
      </dl>
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-ink">{translateText("Lines")}</h3>
        {lines.map((line, index) => {
          const productId = text(line.productId, "");
          const usage = [text(line.dosage, ""), text(line.frequency, ""), text(line.duration, "")]
            .filter((part) => part !== "")
            .join(" · ");
          return (
            <div key={text(line.id, String(index))} className="grid gap-1 rounded-md border border-line p-3 text-sm">
              <strong className="font-medium text-ink">
                {productLabel(products.get(productId), shortId(productId))}
              </strong>
              <span className="text-xs text-muted">
                {translateText("Prescribed")}: {formatQuantity(line.prescribedQuantity)} ·{" "}
                {translateText("Dispensed quantity")}: {formatQuantity(line.dispensedQuantity)}
              </span>
              {usage ? <span className="text-xs text-muted">{usage}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
