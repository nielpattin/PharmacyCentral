import { ActionMenu, Alert, Button, RowActions, StatusBadge, type ActionMenuItem } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { productLabel, useProductLookup } from "../../hooks/useProductLookup.ts";
import { referenceLabel, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { SubTabs } from "../../components/forms.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useFocusSearchHotkey } from "../../hooks/useFocusSearchHotkey.ts";
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
import { DetailField, SalesAuditHistory } from "../sales/shared.tsx";
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
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

  /** A table row shows View, one main action, and the rest in a menu. The drawer footer has room for all of them. */
  const renderActions = (row: JsonRecord, inTable: boolean): React.JSX.Element => {
    const id = text(row.id, "");
    const rowStatus = text(row.status, "");
    const dispensable = canOperateCounter && canDispense(rowStatus);
    const invoiceable = canOperateCounter && canCreateInvoice(rowStatus);
    const cancellable = canOperateCounter && canCancelPrescription(rowStatus);
    const invoice = (): void => void actions.createInvoice(id);
    const cancel = (): void => void actions.cancel(id);
    if (inTable) {
      const menu: ActionMenuItem[] = [
        ...(dispensable && invoiceable
          ? [{ id: "invoice", label: translateText("Create invoice"), onSelect: invoice }]
          : []),
        ...(cancellable
          ? [{ id: "cancel", label: translateText("Cancel prescription"), tone: "danger" as const, onSelect: cancel }]
          : []),
      ];
      return (
        <RowActions label={translateText("Prescription actions")}>
          <Button variant="ghost" size="sm" onClick={() => setOpenId(id)}>
            {translateText("View")}
          </Button>
          {dispensable ? (
            <Button size="sm" onClick={() => onDispense(id)}>
              {translateText("Dispense")}
            </Button>
          ) : invoiceable ? (
            <Button variant="secondary" size="sm" onClick={invoice}>
              {translateText("Create invoice")}
            </Button>
          ) : null}
          {menu.length > 0 ? <ActionMenu label={translateText("More actions")} items={menu} /> : null}
        </RowActions>
      );
    }
    return (
      <RowActions label={translateText("Prescription actions")}>
        {cancellable ? (
          <Button variant="danger-ghost" size="sm" onClick={cancel}>
            {translateText("Cancel prescription")}
          </Button>
        ) : null}
        {invoiceable ? (
          <Button variant="secondary" size="sm" onClick={invoice}>
            {translateText("Create invoice")}
          </Button>
        ) : null}
        {dispensable ? (
          <Button size="sm" onClick={() => onDispense(id)}>
            {translateText("Dispense")}
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
      hideBelow: "lg",
      label: "Site",
      truncate: true,
      render: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
      text: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
    },
    {
      key: "lines",
      hideBelow: "md",
      label: "Lines",
      align: "right",
      enableSorting: false,
      render: (row) => recordList(row.lines).length,
    },
    { key: "createdAt", hideBelow: "lg", label: "Created", render: (row) => formatDateTime(row.createdAt) },
    {
      key: "actions",
      label: "Actions",
      enableSorting: false,
      pinned: "right",
      render: (row) => renderActions(row, true),
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <SubTabs
        tabs={[...PRESCRIPTION_STATUSES]}
        active={status}
        onChange={(next) => setValues({ status: next }, { history: "push" })}
      />
      {queue.error ? <Alert variant="danger">{translateText(queue.error.message)}</Alert> : null}
      <DataTable
        storageKey="staff:sales:prescriptions"
        search={{
          value: draft,
          onChange: setDraft,
          placeholder: translateText("Search by prescription number, patient name, or phone"),
        }}
        toolbarExtra={<SavedViewsMenu pageKey="prescriptions" defaults={QUEUE_DEFAULTS} />}
        loading={queue.isLoading}
        rows={queue.rows}
        columns={columns}
        paging={queue.paging}
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

/** The product's photo at thumbnail size. A product with no photo, or one that fails to load, shows nothing in its place. */
const ProductThumb = ({ url, name }: { url: string; name: string }): React.JSX.Element | null => {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (url === "" || url === failedUrl) return null;
  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      className="size-12 shrink-0 rounded-md border border-line bg-white object-contain"
      onError={() => setFailedUrl(url)}
    />
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
        <h3 className="text-sm font-semibold text-ink">{translateText("Prescribed medicines")}</h3>
        {lines.map((line, index) => {
          const productId = text(line.productId, "");
          const product = products.get(productId);
          const usage = [text(line.dosage, ""), text(line.frequency, ""), text(line.duration, "")]
            .filter((part) => part !== "")
            .join(" · ");
          return (
            <div
              key={text(line.id, String(index))}
              className="flex items-start gap-3 rounded-md border border-line p-3 text-sm"
            >
              <ProductThumb url={text(product?.imageUrl, "")} name={text(product?.name, "")} />
              <div className="grid min-w-0 gap-1">
                <strong className="font-medium text-ink">{productLabel(product, shortId(productId))}</strong>
                <span className="text-xs text-muted">
                  {translateText("Prescribed")}: {formatQuantity(line.prescribedQuantity)} ·{" "}
                  {translateText("Dispensed quantity")}: {formatQuantity(line.dispensedQuantity)}
                </span>
                {usage ? <span className="text-xs text-muted">{usage}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
