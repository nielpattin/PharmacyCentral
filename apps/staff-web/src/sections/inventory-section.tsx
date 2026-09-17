import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import { referenceLabel, referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { useStaffMutation } from "../hooks/useStaffMutation.ts";
import { formatDate, formatDateTime, formatQuantity, readOne, readRows, text, type JsonRecord } from "../staff-api.ts";

type TransferLine = {
  productId: string;
  productBatchId: string;
  sourceStorageLocationId: string;
  destinationStorageLocationId: string;
  quantity: string;
  notes: string;
};
type StocktakeLine = { productBatchId: string };
type CountLine = { lineId: string; countedQuantity: string };
type ReturnLine = {
  productBatchId: string;
  storageLocationId: string;
  quantity: string;
  destination: string;
  notes: string;
};
type ReplenishmentLine = {
  productId: string;
  productBatchId: string;
  requestedQuantity: string;
  reason: string;
  notes: string;
};

const batchInitial = {
  productId: "",
  supplierId: "",
  batchNumber: "",
  manufacturedDate: "",
  expiryDate: "",
  manufacturer: "",
  qualityNotes: "",
};
const movementInitial = {
  productId: "",
  productBatchId: "",
  siteId: "",
  storageLocationId: "",
  quantityDelta: "",
  movementType: "Adjustment",
  reason: "",
  occurredAtUtc: "",
  referenceType: "",
  referenceId: "",
  notes: "",
};
const adjustmentInitial = {
  productId: "",
  productBatchId: "",
  siteId: "",
  storageLocationId: "",
  adjustmentType: "Positive",
  quantity: "1",
  reason: "",
  notes: "",
};
const transferInitial = { transferNumber: "", sourceSiteId: "", destinationSiteId: "" };
const transferLineInitial = (): TransferLine => ({
  productId: "",
  productBatchId: "",
  sourceStorageLocationId: "",
  destinationStorageLocationId: "",
  quantity: "1",
  notes: "",
});
const stocktakeInitial = { siteId: "", storageLocationId: "", notes: "" };
const stocktakeLineInitial = (): StocktakeLine => ({ productBatchId: "" });
const countLineInitial = (): CountLine => ({ lineId: "", countedQuantity: "0" });
const returnInitial = { siteId: "", reason: "", occurredAtUtc: "", destination: "" };
const returnLineInitial = (): ReturnLine => ({
  productBatchId: "",
  storageLocationId: "",
  quantity: "1",
  destination: "",
  notes: "",
});
const replenishInitial = { siteId: "", storageLocationId: "", notes: "" };
const replenishmentLineInitial = (): ReplenishmentLine => ({
  productId: "",
  productBatchId: "",
  requestedQuantity: "1",
  reason: "",
  notes: "",
});

export const InventorySection = ({
  initialTab = "Balances",
}: {
  initialTab?:
    | "Balances"
    | "Batches"
    | "Create batch"
    | "Movements"
    | "Adjustments"
    | "Transfers"
    | "Create transfer"
    | "Stocktake"
    | "Count line"
    | "Returns"
    | "Replenishment";
}): React.JSX.Element => {
  const [tab, setTab] = useState<string>(initialTab);
  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => {
      const [nextBalances, batches, transfers, movements, adjustments, stocktakes, returns, replenishments] =
        await Promise.all([
          readRows("/api/inventory/balances"),
          readRows("/api/inventory/batches"),
          readRows("/api/inventory/transfers"),
          readRows("/api/inventory/movements"),
          readRows("/api/inventory/adjustments"),
          readRows("/api/inventory/stocktakes"),
          readRows("/api/inventory/returns"),
          readRows("/api/inventory/replenishment"),
        ]);
      const balances = nextBalances.map((row) => ({
        ...(typeof row.balance === "object" && row.balance !== null ? row.balance : {}),
        ...(typeof row.batch === "object" && row.batch !== null ? row.batch : {}),
      }));
      return { balances, batches, transfers, movements, adjustments, stocktakes, returns, replenishments };
    },
  });
  const balances = inventoryQuery.data?.balances ?? [];
  const batches = inventoryQuery.data?.batches ?? [];
  const transfers = inventoryQuery.data?.transfers ?? [];
  const [selectedTransfer, setSelectedTransfer] = useState<JsonRecord>();
  const [transferAction, setTransferAction] = useState<"ship" | "receive">("ship");

  const movements = inventoryQuery.data?.movements ?? [];
  const adjustments = inventoryQuery.data?.adjustments ?? [];
  const stocktakes = inventoryQuery.data?.stocktakes ?? [];
  const [selectedStocktake, setSelectedStocktake] = useState<JsonRecord>();
  const returns = inventoryQuery.data?.returns ?? [];
  const replenishments = inventoryQuery.data?.replenishments ?? [];
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();
  const mutation = useStaffMutation();

  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const result = await inventoryQuery.refetch();
      if (result.error) throw result.error;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load inventory");
    }
  };
  const visibleError = error ?? (inventoryQuery.error instanceof Error ? inventoryQuery.error.message : undefined);

  const submit = async (path: string, body: JsonRecord, success: string, reset: () => void): Promise<void> => {
    try {
      await mutation.mutateAsync({ path, method: "POST", body, invalidate: [["inventory"], ["staff-references"]] });
      setMessage(success);
      setError(undefined);
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Inventory operation failed");
    }
  };

  const batchForm = useForm({
    defaultValues: batchInitial,
    onSubmit: async ({ value }) => {
      await submit(
        "/api/inventory/batches",
        {
          productId: value.productId,
          supplierId: value.supplierId || null,
          batchNumber: value.batchNumber,
          manufacturedDate: value.manufacturedDate || null,
          expiryDate: value.expiryDate,
          manufacturer: value.manufacturer || null,
          qualityNotes: value.qualityNotes || null,
        },
        "Batch created.",
        () => batchForm.reset(batchInitial),
      );
    },
  });
  const movementForm = useForm({
    defaultValues: movementInitial,
    onSubmit: async ({ value }) => {
      await submit(
        "/api/inventory/movements",
        {
          productId: value.productId,
          productBatchId: value.productBatchId || undefined,
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          quantityDelta: Number(value.quantityDelta),
          movementType: value.movementType,
          reason: value.reason || undefined,
          occurredAtUtc: value.occurredAtUtc || null,
          referenceType: value.referenceType || null,
          referenceId: value.referenceId || null,
          notes: value.notes || null,
        },
        "Stock movement recorded.",
        () => movementForm.reset(movementInitial),
      );
    },
  });

  const transferForm = useForm({
    defaultValues: { ...transferInitial, lines: [transferLineInitial()] },
    onSubmit: async ({ value }) => {
      await submit(
        "/api/inventory/transfers",
        {
          transferNumber: value.transferNumber,
          sourceSiteId: value.sourceSiteId,
          destinationSiteId: value.destinationSiteId,
          lines: value.lines.map((line) => ({ ...line, quantity: Number(line.quantity), notes: line.notes || null })),
        },
        "Transfer created.",
        () => transferForm.reset({ ...transferInitial, lines: [transferLineInitial()] }),
      );
    },
  });
  const transferActionForm = useForm({
    defaultValues: { lines: [] as Array<{ transferOrderLineId: string; quantity: string }> },
    onSubmit: async ({ value }) => {
      if (!selectedTransfer) return;
      try {
        await mutation.mutateAsync({
          path: "/api/inventory/transfers/" + text(selectedTransfer.id) + "/" + transferAction,
          method: "POST",
          body: {
            lines: value.lines.map((line) =>
              transferAction === "ship"
                ? { transferOrderLineId: line.transferOrderLineId, shippedQuantity: Number(line.quantity) }
                : { transferOrderLineId: line.transferOrderLineId, receivedQuantity: Number(line.quantity) },
            ),
          },
          invalidate: [["inventory"]],
        });
        setMessage("Transfer " + transferAction + "ed.");
        setSelectedTransfer(undefined);
        transferActionForm.reset({ lines: [] });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to update transfer");
      }
    },
  });

  const adjustmentForm = useForm({
    defaultValues: adjustmentInitial,
    onSubmit: async ({ value }) => {
      await submit(
        "/api/inventory/adjustments",
        {
          productId: value.productId,
          productBatchId: value.productBatchId,
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          adjustmentType: value.adjustmentType,
          quantity: Number(value.quantity),
          reason: value.reason,
          notes: value.notes || null,
        },
        "Adjustment submitted for approval.",
        () => adjustmentForm.reset(adjustmentInitial),
      );
    },
  });

  const viewTransfer = async (id: string, mode?: "ship" | "receive"): Promise<void> => {
    try {
      const detail = await readOne<JsonRecord>(`/api/inventory/transfers/${id}`);
      setSelectedTransfer(detail);
      if (mode) {
        setTransferAction(mode);
        transferActionForm.reset({
          lines: Array.isArray(detail.lines)
            ? detail.lines
                .filter((value): value is JsonRecord => typeof value === "object" && value !== null)
                .map((line) => ({
                  transferOrderLineId: text(line.id),
                  quantity:
                    mode === "ship"
                      ? text(line.quantity, "0")
                      : text(Number(line.shippedQuantity ?? 0) - Number(line.receivedQuantity ?? 0), "0"),
                }))
            : [],
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load transfer");
    }
  };
  const submitTransferAction = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void transferActionForm.handleSubmit();
  };

  const stocktakeForm = useForm({
    defaultValues: { ...stocktakeInitial, lines: [stocktakeLineInitial()] },
    onSubmit: async ({ value }) => {
      await submit(
        "/api/inventory/stocktakes",
        {
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          notes: value.notes || null,
          lines: value.lines.map((line) => ({ productBatchId: line.productBatchId })),
        },
        "Stocktake created.",
        () => stocktakeForm.reset({ ...stocktakeInitial, lines: [stocktakeLineInitial()] }),
      );
    },
  });
  const countForm = useForm({
    defaultValues: { lines: [countLineInitial()] },
    onSubmit: async ({ value }) => {
      try {
        await Promise.all(
          value.lines.map((line) =>
            mutation.mutateAsync({
              path: `/api/inventory/stocktake-lines/${line.lineId}/count`,
              method: "POST",
              body: { countedQuantity: Number(line.countedQuantity) },
              invalidate: [["inventory"]],
            }),
          ),
        );
        setMessage("Stocktake count recorded.");
        setError(undefined);
        countForm.reset({ lines: [countLineInitial()] });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Inventory operation failed");
      }
    },
  });
  const returnForm = useForm({
    defaultValues: { ...returnInitial, lines: [returnLineInitial()] },
    onSubmit: async ({ value }) => {
      await submit(
        "/api/inventory/returns",
        {
          siteId: value.siteId,
          reason: value.reason,
          destination: value.destination || null,
          occurredAtUtc: value.occurredAtUtc ? new Date(value.occurredAtUtc).toISOString() : null,
          lines: value.lines.map((line) => ({
            ...line,
            quantity: Number(line.quantity),
            destination: line.destination || value.destination || null,
            notes: line.notes || null,
            occurredAtUtc: value.occurredAtUtc ? new Date(value.occurredAtUtc).toISOString() : null,
          })),
        },
        "Return/removal recorded.",
        () => returnForm.reset({ ...returnInitial, lines: [returnLineInitial()] }),
      );
    },
  });
  const replenishmentForm = useForm({
    defaultValues: { ...replenishInitial, lines: [replenishmentLineInitial()] },
    onSubmit: async ({ value }) => {
      await submit(
        "/api/inventory/replenishment",
        {
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          notes: value.notes || null,
          lines: value.lines.map((line) => ({
            productId: line.productId,
            productBatchId: line.productBatchId,
            requestedQuantity: Number(line.requestedQuantity),
            reason: line.reason || null,
            notes: line.notes || null,
          })),
        },
        "Replenishment requested.",
        () => replenishmentForm.reset({ ...replenishInitial, lines: [replenishmentLineInitial()] }),
      );
    },
  });

  const viewStocktake = (row: JsonRecord): void => setSelectedStocktake(row);
  const postStocktake = async (id: string): Promise<void> => {
    await submit(`/api/inventory/stocktakes/${id}/post`, {}, "Stocktake posted.", () => undefined);
  };
  const quality = async (id: string, decision: "release" | "reject"): Promise<void> => {
    const notes = window.prompt(translateText("Quality review notes:"), "");
    if (notes === null) return;
    await submit(
      `/api/inventory/batches/${id}/quality`,
      { decision, notes: notes || null },
      `Batch ${decision}d.`,
      () => undefined,
    );
  };
  const transition = async (id: string, transitionValue: "approve" | "ship" | "receive" | "cancel"): Promise<void> => {
    await submit(
      `/api/inventory/transfers/${id}/${transitionValue}`,
      {},
      `Transfer ${transitionValue}d.`,
      () => undefined,
    );
  };
  const transitionAdjustment = async (id: string, transitionValue: "approve" | "reject"): Promise<void> => {
    await submit(
      `/api/inventory/adjustments/${id}/${transitionValue}`,
      {},
      `Adjustment ${transitionValue}d.`,
      () => undefined,
    );
  };
  const transferValues = useStore(transferForm.baseStore, (state) => state.values);
  const transferActionValues = useStore(transferActionForm.baseStore, (state) => state.values);
  const stocktakeValues = useStore(stocktakeForm.baseStore, (state) => state.values);
  const countValues = useStore(countForm.baseStore, (state) => state.values);
  const returnValues = useStore(returnForm.baseStore, (state) => state.values);
  const replenishmentValues = useStore(replenishmentForm.baseStore, (state) => state.values);

  const transitionReplenishment = async (
    id: string,
    transitionValue: "approve" | "reject" | "cancel" | "fulfill",
  ): Promise<void> => {
    await submit(
      `/api/inventory/replenishment/${id}/${transitionValue}`,
      {},
      `Replenishment ${transitionValue}d.`,
      () => undefined,
    );
  };

  const stocktakeLineOptions = stocktakes.flatMap((row) => {
    if (!Array.isArray(row.lines)) return [];
    return row.lines.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const line = value as JsonRecord;
      return [
        {
          value: text(line.id),
          label: `${text(row.id).slice(0, 8)} - ${text(line.productBatchId)} - ${text(line.status)}`,
        },
      ];
    });
  });

  const productOptions = referenceOptions(references.products, ["sku", "name"]);
  const batchOptions = referenceOptions(references.batches, ["batchNumber"]);

  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h1>{translateText("Inventory operations")}</h1>
          <p className="page-subtitle">
            {translateText("Stock, quality, movements, transfers, stocktakes, returns, and replenishment.")}
          </p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {visibleError ? <p className="notice">{translateText(visibleError)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs
        tabs={[
          "Balances",
          "Batches",
          "Create batch",
          "Movements",
          "Adjustments",
          "Transfers",
          "Create transfer",
          "Stocktake",
          "Count line",
          "Returns",
          "Replenishment",
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "Balances" ? (
        <DataTable
          loading={inventoryQuery.isPending && !inventoryQuery.data}
          rows={balances}
          columns={[
            {
              key: "productId",
              label: "Product",
              render: (row) => referenceLabel(references.products, row.productId, ["sku", "name"]),
            },
            { key: "batchNumber", label: "Batch" },
            { key: "quantityOnHand", label: "On hand", render: (row) => formatQuantity(row.quantityOnHand) },
            { key: "quantityReserved", label: "Reserved", render: (row) => formatQuantity(row.quantityReserved) },
            { key: "expiryDate", label: "Expiry", render: (row) => formatDate(row.expiryDate) },
          ]}
        />
      ) : null}
      {tab === "Batches" ? (
        <DataTable
          loading={inventoryQuery.isPending && !inventoryQuery.data}
          rows={batches}
          columns={[
            { key: "batchNumber", label: "Batch" },
            {
              key: "productId",
              label: "Product",
              render: (row) => referenceLabel(references.products, row.productId, ["sku", "name"]),
            },
            {
              key: "qualityStatus",
              label: "Quality",
              render: (row) => <span className="status-chip">{translateText(text(row.qualityStatus))}</span>,
            },
            { key: "expiryDate", label: "Expiry", render: (row) => formatDate(row.expiryDate) },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <button
                    className="primary-button small"
                    type="button"
                    onClick={() => void quality(text(row.id), "release")}
                  >
                    {translateText("Release")}
                  </button>
                  <button className="danger-button" type="button" onClick={() => void quality(text(row.id), "reject")}>
                    {translateText("Reject")}
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Create batch" ? (
        <FormCard
          title="Create product batch"
          onSubmit={(event) => {
            event.preventDefault();
            void batchForm.handleSubmit();
          }}
          submitLabel="Create batch"
        >
          <batchForm.Field name="productId">
            {(field) => (
              <SelectField
                label="Product"
                value={field.state.value}
                onChange={field.handleChange}
                options={productOptions}
                required
              />
            )}
          </batchForm.Field>
          <batchForm.Field name="supplierId">
            {(field) => (
              <SelectField
                label="Supplier (optional)"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.suppliers, ["code", "name"])}
              />
            )}
          </batchForm.Field>
          <batchForm.Field name="batchNumber">
            {(field) => <Field label="Batch number" value={field.state.value} onChange={field.handleChange} required />}
          </batchForm.Field>
          <batchForm.Field name="manufacturedDate">
            {(field) => (
              <Field label="Manufactured date" type="date" value={field.state.value} onChange={field.handleChange} />
            )}
          </batchForm.Field>
          <batchForm.Field name="expiryDate">
            {(field) => (
              <Field label="Expiry date" type="date" value={field.state.value} onChange={field.handleChange} required />
            )}
          </batchForm.Field>
          <batchForm.Field name="manufacturer">
            {(field) => <Field label="Manufacturer" value={field.state.value} onChange={field.handleChange} />}
          </batchForm.Field>
          <batchForm.Field name="qualityNotes">
            {(field) => <Field label="Quality notes" value={field.state.value} onChange={field.handleChange} />}
          </batchForm.Field>
        </FormCard>
      ) : null}
      {tab === "Movements" ? (
        <>
          <DataTable
            loading={inventoryQuery.isPending && !inventoryQuery.data}
            rows={movements}
            columns={[
              {
                key: "productId",
                label: "Product",
                render: (row) => referenceLabel(references.products, row.productId, ["sku", "name"]),
              },
              {
                key: "productBatchId",
                label: "Batch",
                render: (row) => referenceLabel(references.batches, row.productBatchId, ["batchNumber"]),
              },
              { key: "quantityDelta", label: "Change", render: (row) => formatQuantity(row.quantityDelta) },
              { key: "quantityAfter", label: "After", render: (row) => formatQuantity(row.quantityAfter) },
              { key: "movementType", label: "Type" },
              { key: "occurredAt", label: "Occurred", render: (row) => formatDateTime(row.occurredAt) },
            ]}
          />
          <FormCard
            title="Record stock movement"
            onSubmit={(event) => {
              event.preventDefault();
              void movementForm.handleSubmit();
            }}
            submitLabel="Record movement"
          >
            <movementForm.Field name="productId">
              {(field) => (
                <SelectField
                  label="Product"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={productOptions}
                  required
                />
              )}
            </movementForm.Field>
            <movementForm.Field name="productBatchId">
              {(field) => (
                <SelectField
                  label="Product batch"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={batchOptions}
                  required
                />
              )}
            </movementForm.Field>
            <movementForm.Field name="siteId">
              {(field) => (
                <SelectField
                  label="Site"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(references.sites, ["code", "name"])}
                  required
                />
              )}
            </movementForm.Field>
            <movementForm.Field name="storageLocationId">
              {(field) => (
                <SelectField
                  label="Storage location"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(references.locations, ["code", "name"])}
                  required
                />
              )}
            </movementForm.Field>
            <movementForm.Field name="quantityDelta">
              {(field) => (
                <Field
                  label="Quantity delta"
                  type="number"
                  value={field.state.value}
                  onChange={field.handleChange}
                  required
                />
              )}
            </movementForm.Field>
            <movementForm.Field name="movementType">
              {(field) => (
                <Field label="Movement type" value={field.state.value} onChange={field.handleChange} required />
              )}
            </movementForm.Field>
            <movementForm.Field name="reason">
              {(field) => <Field label="Reason" value={field.state.value} onChange={field.handleChange} />}
            </movementForm.Field>
            <movementForm.Field name="occurredAtUtc">
              {(field) => (
                <Field
                  label="Occurred at"
                  type="datetime-local"
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </movementForm.Field>
            <movementForm.Field name="referenceType">
              {(field) => <Field label="Reference type" value={field.state.value} onChange={field.handleChange} />}
            </movementForm.Field>
            <movementForm.Field name="referenceId">
              {(field) => <Field label="Reference ID" value={field.state.value} onChange={field.handleChange} />}
            </movementForm.Field>
            <movementForm.Field name="notes">
              {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
            </movementForm.Field>
          </FormCard>
        </>
      ) : null}
      {tab === "Adjustments" ? (
        <>
          <DataTable
            loading={inventoryQuery.isPending && !inventoryQuery.data}
            rows={adjustments}
            columns={[
              {
                key: "productId",
                label: "Product",
                render: (row) => referenceLabel(references.products, row.productId, ["sku", "name"]),
              },
              { key: "adjustmentType", label: "Type" },
              { key: "quantity", label: "Quantity", render: (row) => formatQuantity(row.quantity) },
              { key: "reason", label: "Reason" },
              {
                key: "status",
                label: "Status",
                render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
              },
              {
                key: "actions",
                label: "Actions",
                render: (row) =>
                  text(row.status) === "Pending" ? (
                    <span className="row-actions">
                      <button
                        className="primary-button small"
                        type="button"
                        onClick={() => void transitionAdjustment(text(row.id), "approve")}
                      >
                        {translateText("Approve")}
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => void transitionAdjustment(text(row.id), "reject")}
                      >
                        {translateText("Reject")}
                      </button>
                    </span>
                  ) : null,
              },
            ]}
          />
          <FormCard
            title="Submit stock adjustment"
            onSubmit={(event) => {
              event.preventDefault();
              void adjustmentForm.handleSubmit();
            }}
            submitLabel="Submit adjustment"
          >
            <adjustmentForm.Field name="productId">
              {(field) => (
                <SelectField
                  label="Product"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={productOptions}
                  required
                />
              )}
            </adjustmentForm.Field>
            <adjustmentForm.Field name="productBatchId">
              {(field) => (
                <SelectField
                  label="Product batch"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={batchOptions}
                  required
                />
              )}
            </adjustmentForm.Field>
            <adjustmentForm.Field name="siteId">
              {(field) => (
                <SelectField
                  label="Site"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(references.sites, ["code", "name"])}
                  required
                />
              )}
            </adjustmentForm.Field>
            <adjustmentForm.Field name="storageLocationId">
              {(field) => (
                <SelectField
                  label="Storage location"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(references.locations, ["code", "name"])}
                  required
                />
              )}
            </adjustmentForm.Field>
            <adjustmentForm.Field name="adjustmentType">
              {(field) => (
                <SelectField
                  label="Adjustment type"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={[
                    { value: "Positive", label: "Positive" },
                    { value: "Negative", label: "Negative" },
                  ]}
                  required
                />
              )}
            </adjustmentForm.Field>
            <adjustmentForm.Field name="quantity">
              {(field) => (
                <Field
                  label="Quantity"
                  type="number"
                  value={field.state.value}
                  onChange={field.handleChange}
                  required
                />
              )}
            </adjustmentForm.Field>
            <adjustmentForm.Field name="reason">
              {(field) => <Field label="Reason" value={field.state.value} onChange={field.handleChange} required />}
            </adjustmentForm.Field>
            <adjustmentForm.Field name="notes">
              {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
            </adjustmentForm.Field>
          </FormCard>
        </>
      ) : null}
      {tab === "Transfers" ? (
        <>
          <DataTable
            loading={inventoryQuery.isPending && !inventoryQuery.data}
            rows={transfers}
            columns={[
              { key: "transferNumber", label: "Transfer" },
              {
                key: "status",
                label: "Status",
                render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
              },
              { key: "sourceSiteId", label: "From" },
              { key: "destinationSiteId", label: "To" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <span className="row-actions">
                    <button
                      className="ghost-button small"
                      type="button"
                      onClick={() => void viewTransfer(text(row.id))}
                    >
                      {translateText("View")}
                    </button>
                    {text(row.status) === "PendingApproval" ? (
                      <>
                        <button
                          className="ghost-button small"
                          type="button"
                          onClick={() => void transition(text(row.id), "approve")}
                        >
                          {translateText("Approve")}
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => void transition(text(row.id), "cancel")}
                        >
                          {translateText("Cancel")}
                        </button>
                      </>
                    ) : null}
                    {text(row.status) === "Approved" ? (
                      <>
                        <button
                          className="ghost-button small"
                          type="button"
                          onClick={() => void viewTransfer(text(row.id), "ship")}
                        >
                          {translateText("Ship")}
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => void transition(text(row.id), "cancel")}
                        >
                          {translateText("Cancel")}
                        </button>
                      </>
                    ) : null}
                    {text(row.status) === "InTransit" ? (
                      <button
                        className="ghost-button small"
                        type="button"
                        onClick={() => void viewTransfer(text(row.id), "receive")}
                      >
                        {translateText("Receive")}
                      </button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
          {selectedTransfer ? (
            <div className="detail-panel">
              <h3>{translateText("Transfer details")}</h3>
              <p>
                {text(selectedTransfer.transferNumber)} · {translateText(text(selectedTransfer.status))}
              </p>
              <FormCard
                title={transferAction === "ship" ? "Ship transfer lines" : "Receive transfer lines"}
                onSubmit={submitTransferAction}
                submitLabel={transferAction === "ship" ? "Ship selected quantities" : "Receive selected quantities"}
              >
                <div className="line-list">
                  {transferActionValues.lines.map((line, index) => (
                    <div className="line-card" key={line.transferOrderLineId}>
                      <div className="line-card-header">
                        <strong>
                          {translateText("Line")} {index + 1}
                        </strong>
                      </div>
                      <transferActionForm.Field name={`lines[${index}].quantity` as const}>
                        {(field) => (
                          <Field
                            label={transferAction === "ship" ? "Shipped quantity" : "Received quantity"}
                            type="number"
                            value={field.state.value}
                            onChange={field.handleChange}
                            required
                          />
                        )}
                      </transferActionForm.Field>
                    </div>
                  ))}
                </div>
              </FormCard>
            </div>
          ) : null}
        </>
      ) : null}
      {tab === "Create transfer" ? (
        <FormCard
          title="Create transfer"
          onSubmit={(event) => {
            event.preventDefault();
            void transferForm.handleSubmit();
          }}
          submitLabel="Create transfer"
        >
          <transferForm.Field name="transferNumber">
            {(field) => (
              <Field label="Transfer number" value={field.state.value} onChange={field.handleChange} required />
            )}
          </transferForm.Field>
          <transferForm.Field name="sourceSiteId">
            {(field) => (
              <SelectField
                label="Source site"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.sites, ["code", "name"])}
                required
              />
            )}
          </transferForm.Field>
          <transferForm.Field name="destinationSiteId">
            {(field) => (
              <SelectField
                label="Destination site"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.sites, ["code", "name"])}
                required
              />
            )}
          </transferForm.Field>
          <div className="line-list">
            {transferValues.lines.map((line, index) => (
              <div className="line-card" key={index}>
                <div className="line-card-header">
                  <strong>
                    {translateText("Line")} {index + 1}
                  </strong>
                  {transferValues.lines.length > 1 ? (
                    <button
                      className="danger-button small"
                      type="button"
                      onClick={() =>
                        transferForm.setFieldValue(
                          "lines",
                          transferValues.lines.filter((_item, lineIndex) => lineIndex !== index),
                        )
                      }
                    >
                      {translateText("Remove line")}
                    </button>
                  ) : null}
                </div>
                <div className="form-grid">
                  <transferForm.Field name={`lines[${index}].productId` as const}>
                    {(field) => (
                      <SelectField
                        label="Product"
                        value={field.state.value}
                        onChange={field.handleChange}
                        options={productOptions}
                        required
                      />
                    )}
                  </transferForm.Field>
                  <transferForm.Field name={`lines[${index}].productBatchId` as const}>
                    {(field) => (
                      <SelectField
                        label="Product batch"
                        value={field.state.value}
                        onChange={field.handleChange}
                        options={referenceOptions(
                          references.batches.filter((row) => text(row.productId) === line.productId),
                          ["batchNumber"],
                        )}
                        required
                      />
                    )}
                  </transferForm.Field>
                  <transferForm.Field name={`lines[${index}].sourceStorageLocationId` as const}>
                    {(field) => (
                      <SelectField
                        label="Source location"
                        value={field.state.value}
                        onChange={field.handleChange}
                        options={referenceOptions(
                          references.locations.filter((row) => text(row.siteId) === transferValues.sourceSiteId),
                          ["code", "name"],
                        )}
                        required
                      />
                    )}
                  </transferForm.Field>
                  <transferForm.Field name={`lines[${index}].destinationStorageLocationId` as const}>
                    {(field) => (
                      <SelectField
                        label="Destination location"
                        value={field.state.value}
                        onChange={field.handleChange}
                        options={referenceOptions(
                          references.locations.filter((row) => text(row.siteId) === transferValues.destinationSiteId),
                          ["code", "name"],
                        )}
                        required
                      />
                    )}
                  </transferForm.Field>
                  <transferForm.Field name={`lines[${index}].quantity` as const}>
                    {(field) => (
                      <Field
                        label="Quantity"
                        type="number"
                        value={field.state.value}
                        onChange={field.handleChange}
                        required
                      />
                    )}
                  </transferForm.Field>
                  <transferForm.Field name={`lines[${index}].notes` as const}>
                    {(field) => <Field label="Line notes" value={field.state.value} onChange={field.handleChange} />}
                  </transferForm.Field>
                </div>
              </div>
            ))}
          </div>
          <div className="line-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => transferForm.setFieldValue("lines", [...transferValues.lines, transferLineInitial()])}
            >
              {translateText("Add line")}
            </button>
          </div>
        </FormCard>
      ) : null}
      {tab === "Stocktake" ? (
        <>
          <DataTable
            loading={inventoryQuery.isPending && !inventoryQuery.data}
            rows={stocktakes}
            columns={[
              { key: "id", label: "Session" },
              {
                key: "siteId",
                label: "Site",
                render: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
              },
              { key: "storageLocationId", label: "Location" },
              {
                key: "status",
                label: "Status",
                render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
              },
              { key: "lines", label: "Lines", render: (row) => (Array.isArray(row.lines) ? row.lines.length : 0) },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <span className="row-actions">
                    <button className="ghost-button small" type="button" onClick={() => viewStocktake(row)}>
                      {translateText("View")}
                    </button>
                    {text(row.status) === "Pending" ? (
                      <button
                        className="primary-button small"
                        type="button"
                        onClick={() => void postStocktake(text(row.id))}
                      >
                        {translateText("Post adjustments")}
                      </button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
          {selectedStocktake ? (
            <div className="detail-panel">
              <h3>{translateText("Stocktake details")}</h3>
              <p>
                {text(selectedStocktake.notes)} · {translateText(text(selectedStocktake.status))}
              </p>
              <DataTable
                loading={inventoryQuery.isPending && !inventoryQuery.data}
                rows={
                  Array.isArray(selectedStocktake.lines)
                    ? selectedStocktake.lines.filter(
                        (value): value is JsonRecord => typeof value === "object" && value !== null,
                      )
                    : []
                }
                columns={[
                  {
                    key: "productId",
                    label: "Product",
                    render: (row) => referenceLabel(references.products, row.productId, ["sku", "name"]),
                  },
                  { key: "productBatchId", label: "Batch" },
                  { key: "systemQuantity", label: "System quantity" },
                  { key: "countedQuantity", label: "Counted quantity" },
                  { key: "status", label: "Status" },
                ]}
              />
            </div>
          ) : null}
          <FormCard
            title="Create stocktake"
            onSubmit={(event) => {
              event.preventDefault();
              void stocktakeForm.handleSubmit();
            }}
            submitLabel="Create stocktake"
          >
            <stocktakeForm.Field name="siteId">
              {(field) => (
                <SelectField
                  label="Site"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(references.sites, ["code", "name"])}
                  required
                />
              )}
            </stocktakeForm.Field>
            <stocktakeForm.Field name="storageLocationId">
              {(field) => (
                <SelectField
                  label="Storage location"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(
                    references.locations.filter((row) => text(row.siteId) === stocktakeValues.siteId),
                    ["code", "name"],
                  )}
                  required
                />
              )}
            </stocktakeForm.Field>
            <stocktakeForm.Field name="notes">
              {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
            </stocktakeForm.Field>
            <div className="line-list">
              {stocktakeValues.lines.map((line, index) => (
                <div className="line-card" key={index}>
                  <div className="line-card-header">
                    <strong>
                      {translateText("Line")} {index + 1}
                    </strong>
                    {stocktakeValues.lines.length > 1 ? (
                      <button
                        className="danger-button small"
                        type="button"
                        onClick={() =>
                          stocktakeForm.setFieldValue(
                            "lines",
                            stocktakeValues.lines.filter((_item, lineIndex) => lineIndex !== index),
                          )
                        }
                      >
                        {translateText("Remove line")}
                      </button>
                    ) : null}
                  </div>
                  <stocktakeForm.Field name={`lines[${index}].productBatchId` as const}>
                    {(field) => (
                      <SelectField
                        label="Product batch"
                        value={field.state.value}
                        onChange={field.handleChange}
                        options={batchOptions}
                        required
                      />
                    )}
                  </stocktakeForm.Field>
                </div>
              ))}
            </div>
            <p className="form-help">
              {translateText(
                "The system quantity is captured from the selected inventory balance when the session is created.",
              )}
            </p>
          </FormCard>
        </>
      ) : null}
      {tab === "Count line" ? (
        <FormCard
          title="Record stocktake count"
          onSubmit={(event) => {
            event.preventDefault();
            void countForm.handleSubmit();
          }}
          submitLabel="Record count"
        >
          <div className="line-list">
            {countValues.lines.map((line, index) => (
              <div className="line-card" key={index}>
                <div className="line-card-header">
                  <strong>
                    {translateText("Line")} {index + 1}
                  </strong>
                  {countValues.lines.length > 1 ? (
                    <button
                      className="danger-button small"
                      type="button"
                      onClick={() =>
                        countForm.setFieldValue(
                          "lines",
                          countValues.lines.filter((_item, lineIndex) => lineIndex !== index),
                        )
                      }
                    >
                      {translateText("Remove line")}
                    </button>
                  ) : null}
                </div>
                <div className="form-grid">
                  <countForm.Field name={`lines[${index}].lineId` as const}>
                    {(field) => (
                      <SelectField
                        label="Stocktake line"
                        value={field.state.value}
                        onChange={field.handleChange}
                        options={stocktakeLineOptions}
                        required
                      />
                    )}
                  </countForm.Field>
                  <countForm.Field name={`lines[${index}].countedQuantity` as const}>
                    {(field) => (
                      <Field
                        label="Counted quantity"
                        type="number"
                        value={field.state.value}
                        onChange={field.handleChange}
                        required
                      />
                    )}
                  </countForm.Field>
                </div>
              </div>
            ))}
          </div>
          <div className="line-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => countForm.setFieldValue("lines", [...countValues.lines, countLineInitial()])}
            >
              {translateText("Add line")}
            </button>
          </div>
        </FormCard>
      ) : null}
      {tab === "Returns" ? (
        <>
          <DataTable
            loading={inventoryQuery.isPending && !inventoryQuery.data}
            rows={returns}
            columns={[
              { key: "id", label: "Return" },
              {
                key: "siteId",
                label: "Site",
                render: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
              },
              { key: "reason", label: "Reason" },
              {
                key: "status",
                label: "Status",
                render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
              },
              { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
          <FormCard
            title="Record return or removal"
            onSubmit={(event) => {
              event.preventDefault();
              void returnForm.handleSubmit();
            }}
            submitLabel="Record return"
          >
            <returnForm.Field name="siteId">
              {(field) => (
                <SelectField
                  label="Site"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(references.sites, ["code", "name"])}
                  required
                />
              )}
            </returnForm.Field>
            <returnForm.Field name="reason">
              {(field) => <Field label="Reason" value={field.state.value} onChange={field.handleChange} required />}
            </returnForm.Field>
            <returnForm.Field name="destination">
              {(field) => <Field label="Destination" value={field.state.value} onChange={field.handleChange} />}
            </returnForm.Field>
            <returnForm.Field name="occurredAtUtc">
              {(field) => (
                <Field
                  label="Occurred at"
                  type="datetime-local"
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </returnForm.Field>
            <div className="line-list">
              {returnValues.lines.map((line, index) => (
                <div className="line-card" key={index}>
                  <div className="line-card-header">
                    <strong>
                      {translateText("Line")} {index + 1}
                    </strong>
                    {returnValues.lines.length > 1 ? (
                      <button
                        className="danger-button small"
                        type="button"
                        onClick={() =>
                          returnForm.setFieldValue(
                            "lines",
                            returnValues.lines.filter((_item, lineIndex) => lineIndex !== index),
                          )
                        }
                      >
                        {translateText("Remove line")}
                      </button>
                    ) : null}
                  </div>
                  <div className="form-grid">
                    <returnForm.Field name={`lines[${index}].productBatchId` as const}>
                      {(field) => (
                        <SelectField
                          label="Product batch"
                          value={field.state.value}
                          onChange={field.handleChange}
                          options={batchOptions}
                          required
                        />
                      )}
                    </returnForm.Field>
                    <returnForm.Field name={`lines[${index}].storageLocationId` as const}>
                      {(field) => (
                        <SelectField
                          label="Storage location"
                          value={field.state.value}
                          onChange={field.handleChange}
                          options={referenceOptions(
                            references.locations.filter((row) => text(row.siteId) === returnValues.siteId),
                            ["code", "name"],
                          )}
                          required
                        />
                      )}
                    </returnForm.Field>
                    <returnForm.Field name={`lines[${index}].quantity` as const}>
                      {(field) => (
                        <Field
                          label="Quantity"
                          type="number"
                          value={field.state.value}
                          onChange={field.handleChange}
                          required
                        />
                      )}
                    </returnForm.Field>
                    <returnForm.Field name={`lines[${index}].destination` as const}>
                      {(field) => (
                        <Field label="Line destination" value={field.state.value} onChange={field.handleChange} />
                      )}
                    </returnForm.Field>
                    <returnForm.Field name={`lines[${index}].notes` as const}>
                      {(field) => <Field label="Line notes" value={field.state.value} onChange={field.handleChange} />}
                    </returnForm.Field>
                  </div>
                </div>
              ))}
            </div>
            <div className="line-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => returnForm.setFieldValue("lines", [...returnValues.lines, returnLineInitial()])}
              >
                {translateText("Add line")}
              </button>
            </div>
          </FormCard>
        </>
      ) : null}
      {tab === "Replenishment" ? (
        <>
          <DataTable
            loading={inventoryQuery.isPending && !inventoryQuery.data}
            rows={replenishments}
            columns={[
              { key: "id", label: "Request" },
              {
                key: "productId",
                label: "Product",
                render: (row) => referenceLabel(references.products, row.productId, ["sku", "name"]),
              },
              {
                key: "siteId",
                label: "Site",
                render: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
              },
              { key: "requestedQuantity", label: "Quantity", render: (row) => formatQuantity(row.requestedQuantity) },
              { key: "lines", label: "Lines", render: (row) => (Array.isArray(row.lines) ? row.lines.length : 1) },
              {
                key: "status",
                label: "Status",
                render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
              },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <span className="row-actions">
                    {text(row.status) === "Pending" ? (
                      <>
                        <button
                          className="primary-button small"
                          type="button"
                          onClick={() => void transitionReplenishment(text(row.id), "approve")}
                        >
                          {translateText("Approve")}
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => void transitionReplenishment(text(row.id), "reject")}
                        >
                          {translateText("Reject")}
                        </button>
                      </>
                    ) : null}
                    {text(row.status) === "Approved" ? (
                      <>
                        <button
                          className="primary-button small"
                          type="button"
                          onClick={() => void transitionReplenishment(text(row.id), "fulfill")}
                        >
                          {translateText("Fulfill")}
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => void transitionReplenishment(text(row.id), "cancel")}
                        >
                          {translateText("Cancel")}
                        </button>
                      </>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
          <FormCard
            title="Request replenishment"
            onSubmit={(event) => {
              event.preventDefault();
              void replenishmentForm.handleSubmit();
            }}
            submitLabel="Request stock"
          >
            <replenishmentForm.Field name="siteId">
              {(field) => (
                <SelectField
                  label="Site"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(references.sites, ["code", "name"])}
                  required
                />
              )}
            </replenishmentForm.Field>
            <replenishmentForm.Field name="storageLocationId">
              {(field) => (
                <SelectField
                  label="Storage location"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(
                    references.locations.filter((row) => text(row.siteId) === replenishmentValues.siteId),
                    ["code", "name"],
                  )}
                  required
                />
              )}
            </replenishmentForm.Field>
            <div className="line-list">
              {replenishmentValues.lines.map((line, index) => (
                <div className="line-card" key={index}>
                  <div className="line-card-header">
                    <strong>
                      {translateText("Line")} {index + 1}
                    </strong>
                    {replenishmentValues.lines.length > 1 ? (
                      <button
                        className="danger-button small"
                        type="button"
                        onClick={() =>
                          replenishmentForm.setFieldValue(
                            "lines",
                            replenishmentValues.lines.filter((_item, lineIndex) => lineIndex !== index),
                          )
                        }
                      >
                        {translateText("Remove line")}
                      </button>
                    ) : null}
                  </div>
                  <div className="form-grid">
                    <replenishmentForm.Field name={`lines[${index}].productId` as const}>
                      {(field) => (
                        <SelectField
                          label="Product"
                          value={field.state.value}
                          onChange={field.handleChange}
                          options={productOptions}
                          required
                        />
                      )}
                    </replenishmentForm.Field>
                    <replenishmentForm.Field name={`lines[${index}].productBatchId` as const}>
                      {(field) => (
                        <SelectField
                          label="Product batch"
                          value={field.state.value}
                          onChange={field.handleChange}
                          options={referenceOptions(
                            references.batches.filter((row) => text(row.productId) === line.productId),
                            ["batchNumber"],
                          )}
                          required
                        />
                      )}
                    </replenishmentForm.Field>
                    <replenishmentForm.Field name={`lines[${index}].requestedQuantity` as const}>
                      {(field) => (
                        <Field
                          label="Requested quantity"
                          type="number"
                          value={field.state.value}
                          onChange={field.handleChange}
                          required
                        />
                      )}
                    </replenishmentForm.Field>
                    <replenishmentForm.Field name={`lines[${index}].reason` as const}>
                      {(field) => <Field label="Reason" value={field.state.value} onChange={field.handleChange} />}
                    </replenishmentForm.Field>
                    <replenishmentForm.Field name={`lines[${index}].notes` as const}>
                      {(field) => <Field label="Line notes" value={field.state.value} onChange={field.handleChange} />}
                    </replenishmentForm.Field>
                  </div>
                </div>
              ))}
            </div>
            <div className="line-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() =>
                  replenishmentForm.setFieldValue("lines", [...replenishmentValues.lines, replenishmentLineInitial()])
                }
              >
                {translateText("Add line")}
              </button>
            </div>
            <replenishmentForm.Field name="notes">
              {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
            </replenishmentForm.Field>
          </FormCard>
        </>
      ) : null}
    </section>
  );
};
