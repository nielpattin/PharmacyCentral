import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { readOne, readRows, text, writeJson, type JsonRecord } from "../staff-api.ts";

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
  const [balances, setBalances] = useState<JsonRecord[]>([]);
  const [batches, setBatches] = useState<JsonRecord[]>([]);
  const [transfers, setTransfers] = useState<JsonRecord[]>([]);
  const [selectedTransfer, setSelectedTransfer] = useState<JsonRecord>();
  const [transferAction, setTransferAction] = useState<"ship" | "receive">("ship");
  const [transferActionLines, setTransferActionLines] = useState<
    Array<{ transferOrderLineId: string; quantity: string }>
  >([]);
  const [movements, setMovements] = useState<JsonRecord[]>([]);
  const [adjustments, setAdjustments] = useState<JsonRecord[]>([]);
  const [stocktakes, setStocktakes] = useState<JsonRecord[]>([]);
  const [selectedStocktake, setSelectedStocktake] = useState<JsonRecord>();
  const [returns, setReturns] = useState<JsonRecord[]>([]);
  const [replenishments, setReplenishments] = useState<JsonRecord[]>([]);
  const [batch, setBatch] = useState(batchInitial);
  const [movement, setMovement] = useState(movementInitial);
  const [adjustment, setAdjustment] = useState(adjustmentInitial);
  const [transfer, setTransfer] = useState(transferInitial);
  const [transferLines, setTransferLines] = useState<TransferLine[]>([transferLineInitial()]);
  const [stocktake, setStocktake] = useState(stocktakeInitial);
  const [stocktakeLines, setStocktakeLines] = useState<StocktakeLine[]>([stocktakeLineInitial()]);
  const [countLines, setCountLines] = useState<CountLine[]>([countLineInitial()]);
  const [returnForm, setReturnForm] = useState(returnInitial);
  const [returnLines, setReturnLines] = useState<ReturnLine[]>([returnLineInitial()]);
  const [replenish, setReplenish] = useState(replenishInitial);
  const [replenishmentLines, setReplenishmentLines] = useState<ReplenishmentLine[]>([replenishmentLineInitial()]);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();

  const load = async (): Promise<void> => {
    try {
      setError(undefined);
      const [
        nextBalances,
        nextBatches,
        nextTransfers,
        nextMovements,
        nextAdjustments,
        nextStocktakes,
        nextReturns,
        nextReplenishments,
      ] = await Promise.all([
        readRows("/api/inventory/balances"),
        readRows("/api/inventory/batches"),
        readRows("/api/inventory/transfers"),
        readRows("/api/inventory/movements"),
        readRows("/api/inventory/adjustments"),
        readRows("/api/inventory/stocktakes"),
        readRows("/api/inventory/returns"),
        readRows("/api/inventory/replenishment"),
      ]);
      setBalances(
        nextBalances.map((row) => ({
          ...(typeof row.balance === "object" && row.balance !== null ? row.balance : {}),
          ...(typeof row.batch === "object" && row.batch !== null ? row.batch : {}),
        })),
      );
      setBatches(nextBatches);
      setTransfers(nextTransfers);
      setMovements(nextMovements);
      setAdjustments(nextAdjustments);
      setStocktakes(nextStocktakes);
      setReturns(nextReturns);
      setReplenishments(nextReplenishments);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load inventory");
    }
  };

  useMountEffect(() => {
    void load();
  });

  const setValue =
    <T extends Record<string, string>>(setter: React.Dispatch<React.SetStateAction<T>>, key: keyof T) =>
    (value: string): void =>
      setter((current) => ({ ...current, [key]: value }));
  const updateTransferLine = (index: number, key: keyof TransferLine, value: string): void =>
    setTransferLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const updateStocktakeLine = (index: number, value: string): void =>
    setStocktakeLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, productBatchId: value } : line)),
    );
  const updateCountLine = (index: number, key: keyof CountLine, value: string): void =>
    setCountLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const updateReturnLine = (index: number, key: keyof ReturnLine, value: string): void =>
    setReturnLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const updateReplenishmentLine = (index: number, key: keyof ReplenishmentLine, value: string): void =>
    setReplenishmentLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const removeLine = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number): void =>
    setter((current) => (current.length <= 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));

  const submit = async (path: string, body: JsonRecord, success: string, reset: () => void): Promise<void> => {
    try {
      await writeJson(path, "POST", body);
      setMessage(success);
      setError(undefined);
      reset();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Inventory operation failed");
    }
  };

  const createBatch = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/inventory/batches",
      {
        productId: batch.productId,
        supplierId: batch.supplierId || null,
        batchNumber: batch.batchNumber,
        manufacturedDate: batch.manufacturedDate || null,
        expiryDate: batch.expiryDate,
        manufacturer: batch.manufacturer || null,
        qualityNotes: batch.qualityNotes || null,
      },
      "Batch created.",
      () => setBatch(batchInitial),
    );
  };

  const createMovement = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/inventory/movements",
      {
        productId: movement.productId,
        productBatchId: movement.productBatchId || undefined,
        siteId: movement.siteId,
        storageLocationId: movement.storageLocationId,
        quantityDelta: Number(movement.quantityDelta),
        movementType: movement.movementType,
        reason: movement.reason || undefined,
        occurredAtUtc: movement.occurredAtUtc || null,
        referenceType: movement.referenceType || null,
        referenceId: movement.referenceId || null,
        notes: movement.notes || null,
      },
      "Stock movement recorded.",
      () => setMovement(movementInitial),
    );
  };

  const createAdjustment = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/inventory/adjustments",
      {
        productId: adjustment.productId,
        productBatchId: adjustment.productBatchId,
        siteId: adjustment.siteId,
        storageLocationId: adjustment.storageLocationId,
        adjustmentType: adjustment.adjustmentType,
        quantity: Number(adjustment.quantity),
        reason: adjustment.reason,
        notes: adjustment.notes || null,
      },
      "Adjustment submitted for approval.",
      () => setAdjustment(adjustmentInitial),
    );
  };

  const viewTransfer = async (id: string, mode?: "ship" | "receive"): Promise<void> => {
    try {
      const detail = await readOne<JsonRecord>(`/api/inventory/transfers/${id}`);
      setSelectedTransfer(detail);
      if (mode) {
        setTransferAction(mode);
        setTransferActionLines(
          Array.isArray(detail.lines)
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
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load transfer");
    }
  };
  const submitTransferAction = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedTransfer) return;
    try {
      await writeJson(`/api/inventory/transfers/${text(selectedTransfer.id)}/${transferAction}`, "POST", {
        lines: transferActionLines.map((line) =>
          transferAction === "ship"
            ? { transferOrderLineId: line.transferOrderLineId, shippedQuantity: Number(line.quantity) }
            : { transferOrderLineId: line.transferOrderLineId, receivedQuantity: Number(line.quantity) },
        ),
      });
      setMessage(`Transfer ${transferAction}ed.`);
      setSelectedTransfer(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update transfer");
    }
  };

  const createTransfer = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/inventory/transfers",
      {
        transferNumber: transfer.transferNumber,
        sourceSiteId: transfer.sourceSiteId,
        destinationSiteId: transfer.destinationSiteId,
        lines: transferLines.map((line) => ({ ...line, quantity: Number(line.quantity), notes: line.notes || null })),
      },
      "Transfer created.",
      () => {
        setTransfer(transferInitial);
        setTransferLines([transferLineInitial()]);
      },
    );
  };

  const createStocktake = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/inventory/stocktakes",
      {
        siteId: stocktake.siteId,
        storageLocationId: stocktake.storageLocationId,
        notes: stocktake.notes || null,
        lines: stocktakeLines.map((line) => ({ productBatchId: line.productBatchId })),
      },
      "Stocktake created.",
      () => {
        setStocktake(stocktakeInitial);
        setStocktakeLines([stocktakeLineInitial()]);
      },
    );
  };

  const countStocktakeLines = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await Promise.all(
        countLines.map((line) =>
          writeJson(`/api/inventory/stocktake-lines/${line.lineId}/count`, "POST", {
            countedQuantity: Number(line.countedQuantity),
          }),
        ),
      );
      setMessage("Stocktake count recorded.");
      setError(undefined);
      setCountLines([countLineInitial()]);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Inventory operation failed");
    }
  };

  const createReturn = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/inventory/returns",
      {
        siteId: returnForm.siteId,
        reason: returnForm.reason,
        destination: returnForm.destination || null,
        occurredAtUtc: returnForm.occurredAtUtc ? new Date(returnForm.occurredAtUtc).toISOString() : null,
        lines: returnLines.map((line) => ({
          ...line,
          quantity: Number(line.quantity),
          destination: line.destination || returnForm.destination || null,
          notes: line.notes || null,
          occurredAtUtc: returnForm.occurredAtUtc ? new Date(returnForm.occurredAtUtc).toISOString() : null,
        })),
      },
      "Return/removal recorded.",
      () => {
        setReturnForm(returnInitial);
        setReturnLines([returnLineInitial()]);
      },
    );
  };

  const createReplenishment = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/inventory/replenishment",
      {
        siteId: replenish.siteId,
        storageLocationId: replenish.storageLocationId,
        notes: replenish.notes || null,
        lines: replenishmentLines.map((line) => ({
          productId: line.productId,
          productBatchId: line.productBatchId,
          requestedQuantity: Number(line.requestedQuantity),
          reason: line.reason || null,
          notes: line.notes || null,
        })),
      },
      "Replenishment requested.",
      () => {
        setReplenish(replenishInitial);
        setReplenishmentLines([replenishmentLineInitial()]);
      },
    );
  };

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
          <h2>{translateText("Inventory operations")}</h2>
          <p className="page-subtitle">
            {translateText("Stock, quality, movements, transfers, stocktakes, returns, and replenishment.")}
          </p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {error ? <p className="notice">{translateText(error)}</p> : null}
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
          rows={balances}
          columns={[
            { key: "productId", label: "Product" },
            { key: "batchNumber", label: "Batch" },
            { key: "quantityOnHand", label: "On hand" },
            { key: "quantityReserved", label: "Reserved" },
            { key: "expiryDate", label: "Expiry" },
          ]}
        />
      ) : null}
      {tab === "Batches" ? (
        <DataTable
          rows={batches}
          columns={[
            { key: "batchNumber", label: "Batch" },
            { key: "productId", label: "Product" },
            {
              key: "qualityStatus",
              label: "Quality",
              render: (row) => <span className="status-chip">{translateText(text(row.qualityStatus))}</span>,
            },
            { key: "expiryDate", label: "Expiry" },
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
        <FormCard title="Create product batch" onSubmit={(event) => void createBatch(event)} submitLabel="Create batch">
          <SelectField
            label="Product"
            value={batch.productId}
            onChange={setValue(setBatch, "productId")}
            options={productOptions}
            required
          />
          <SelectField
            label="Supplier (optional)"
            value={batch.supplierId}
            onChange={setValue(setBatch, "supplierId")}
            options={referenceOptions(references.suppliers, ["code", "name"])}
          />
          <Field label="Batch number" value={batch.batchNumber} onChange={setValue(setBatch, "batchNumber")} required />
          <Field
            label="Manufactured date"
            type="date"
            value={batch.manufacturedDate}
            onChange={setValue(setBatch, "manufacturedDate")}
          />
          <Field
            label="Expiry date"
            type="date"
            value={batch.expiryDate}
            onChange={setValue(setBatch, "expiryDate")}
            required
          />
          <Field label="Manufacturer" value={batch.manufacturer} onChange={setValue(setBatch, "manufacturer")} />
          <Field label="Quality notes" value={batch.qualityNotes} onChange={setValue(setBatch, "qualityNotes")} />
        </FormCard>
      ) : null}
      {tab === "Movements" ? (
        <>
          <DataTable
            rows={movements}
            columns={[
              { key: "productId", label: "Product" },
              { key: "productBatchId", label: "Batch" },
              { key: "quantityDelta", label: "Change" },
              { key: "quantityAfter", label: "After" },
              { key: "movementType", label: "Type" },
              { key: "occurredAt", label: "Occurred" },
            ]}
          />
          <FormCard
            title="Record stock movement"
            onSubmit={(event) => void createMovement(event)}
            submitLabel="Record movement"
          >
            <SelectField
              label="Product"
              value={movement.productId}
              onChange={setValue(setMovement, "productId")}
              options={productOptions}
              required
            />
            <SelectField
              label="Product batch"
              value={movement.productBatchId}
              onChange={setValue(setMovement, "productBatchId")}
              options={batchOptions}
              required
            />
            <SelectField
              label="Site"
              value={movement.siteId}
              onChange={setValue(setMovement, "siteId")}
              options={referenceOptions(references.sites, ["code", "name"])}
              required
            />
            <SelectField
              label="Storage location"
              value={movement.storageLocationId}
              onChange={setValue(setMovement, "storageLocationId")}
              options={referenceOptions(references.locations, ["code", "name"])}
              required
            />
            <Field
              label="Quantity delta"
              type="number"
              value={movement.quantityDelta}
              onChange={setValue(setMovement, "quantityDelta")}
              required
            />
            <Field
              label="Movement type"
              value={movement.movementType}
              onChange={setValue(setMovement, "movementType")}
              required
            />
            <Field label="Reason" value={movement.reason} onChange={setValue(setMovement, "reason")} />
            <Field
              label="Occurred at"
              type="datetime-local"
              value={movement.occurredAtUtc}
              onChange={setValue(setMovement, "occurredAtUtc")}
            />
            <Field
              label="Reference type"
              value={movement.referenceType}
              onChange={setValue(setMovement, "referenceType")}
            />
            <Field label="Reference ID" value={movement.referenceId} onChange={setValue(setMovement, "referenceId")} />
            <Field label="Notes" value={movement.notes} onChange={setValue(setMovement, "notes")} />
          </FormCard>
        </>
      ) : null}
      {tab === "Adjustments" ? (
        <>
          <DataTable
            rows={adjustments}
            columns={[
              { key: "productId", label: "Product" },
              { key: "adjustmentType", label: "Type" },
              { key: "quantity", label: "Quantity" },
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
            onSubmit={(event) => void createAdjustment(event)}
            submitLabel="Submit adjustment"
          >
            <SelectField
              label="Product"
              value={adjustment.productId}
              onChange={setValue(setAdjustment, "productId")}
              options={productOptions}
              required
            />
            <SelectField
              label="Product batch"
              value={adjustment.productBatchId}
              onChange={setValue(setAdjustment, "productBatchId")}
              options={batchOptions}
              required
            />
            <SelectField
              label="Site"
              value={adjustment.siteId}
              onChange={setValue(setAdjustment, "siteId")}
              options={referenceOptions(references.sites, ["code", "name"])}
              required
            />
            <SelectField
              label="Storage location"
              value={adjustment.storageLocationId}
              onChange={setValue(setAdjustment, "storageLocationId")}
              options={referenceOptions(references.locations, ["code", "name"])}
              required
            />
            <SelectField
              label="Adjustment type"
              value={adjustment.adjustmentType}
              onChange={setValue(setAdjustment, "adjustmentType")}
              options={[
                { value: "Positive", label: "Positive" },
                { value: "Negative", label: "Negative" },
              ]}
              required
            />
            <Field
              label="Quantity"
              type="number"
              value={adjustment.quantity}
              onChange={setValue(setAdjustment, "quantity")}
              required
            />
            <Field label="Reason" value={adjustment.reason} onChange={setValue(setAdjustment, "reason")} required />
            <Field label="Notes" value={adjustment.notes} onChange={setValue(setAdjustment, "notes")} />
          </FormCard>
        </>
      ) : null}
      {tab === "Transfers" ? (
        <>
          <DataTable
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
                onSubmit={(event) => void submitTransferAction(event)}
                submitLabel={transferAction === "ship" ? "Ship selected quantities" : "Receive selected quantities"}
              >
                <div className="line-list">
                  {transferActionLines.map((line, index) => (
                    <div className="line-card" key={line.transferOrderLineId}>
                      <div className="line-card-header">
                        <strong>
                          {translateText("Line")} {index + 1}
                        </strong>
                      </div>
                      <Field
                        label={transferAction === "ship" ? "Shipped quantity" : "Received quantity"}
                        type="number"
                        value={line.quantity}
                        onChange={(value) =>
                          setTransferActionLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, quantity: value } : item,
                            ),
                          )
                        }
                        required
                      />
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
          onSubmit={(event) => void createTransfer(event)}
          submitLabel="Create transfer"
        >
          <Field
            label="Transfer number"
            value={transfer.transferNumber}
            onChange={setValue(setTransfer, "transferNumber")}
            required
          />
          <SelectField
            label="Source site"
            value={transfer.sourceSiteId}
            onChange={setValue(setTransfer, "sourceSiteId")}
            options={referenceOptions(references.sites, ["code", "name"])}
            required
          />
          <SelectField
            label="Destination site"
            value={transfer.destinationSiteId}
            onChange={setValue(setTransfer, "destinationSiteId")}
            options={referenceOptions(references.sites, ["code", "name"])}
            required
          />
          <div className="line-list">
            {transferLines.map((line, index) => (
              <div className="line-card" key={index}>
                <div className="line-card-header">
                  <strong>
                    {translateText("Line")} {index + 1}
                  </strong>
                  {transferLines.length > 1 ? (
                    <button
                      className="danger-button small"
                      type="button"
                      onClick={() => removeLine(setTransferLines, index)}
                    >
                      {translateText("Remove line")}
                    </button>
                  ) : null}
                </div>
                <div className="form-grid">
                  <SelectField
                    label="Product"
                    value={line.productId}
                    onChange={(value) => updateTransferLine(index, "productId", value)}
                    options={productOptions}
                    required
                  />
                  <SelectField
                    label="Product batch"
                    value={line.productBatchId}
                    onChange={(value) => updateTransferLine(index, "productBatchId", value)}
                    options={referenceOptions(
                      references.batches.filter((row) => text(row.productId) === line.productId),
                      ["batchNumber"],
                    )}
                    required
                  />
                  <SelectField
                    label="Source location"
                    value={line.sourceStorageLocationId}
                    onChange={(value) => updateTransferLine(index, "sourceStorageLocationId", value)}
                    options={referenceOptions(
                      references.locations.filter((row) => text(row.siteId) === transfer.sourceSiteId),
                      ["code", "name"],
                    )}
                    required
                  />
                  <SelectField
                    label="Destination location"
                    value={line.destinationStorageLocationId}
                    onChange={(value) => updateTransferLine(index, "destinationStorageLocationId", value)}
                    options={referenceOptions(
                      references.locations.filter((row) => text(row.siteId) === transfer.destinationSiteId),
                      ["code", "name"],
                    )}
                    required
                  />
                  <Field
                    label="Quantity"
                    type="number"
                    value={line.quantity}
                    onChange={(value) => updateTransferLine(index, "quantity", value)}
                    required
                  />
                  <Field
                    label="Line notes"
                    value={line.notes}
                    onChange={(value) => updateTransferLine(index, "notes", value)}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="line-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => setTransferLines((current) => [...current, transferLineInitial()])}
            >
              {translateText("Add line")}
            </button>
          </div>
        </FormCard>
      ) : null}
      {tab === "Stocktake" ? (
        <>
          <DataTable
            rows={stocktakes}
            columns={[
              { key: "id", label: "Session" },
              { key: "siteId", label: "Site" },
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
                rows={
                  Array.isArray(selectedStocktake.lines)
                    ? selectedStocktake.lines.filter(
                        (value): value is JsonRecord => typeof value === "object" && value !== null,
                      )
                    : []
                }
                columns={[
                  { key: "productId", label: "Product" },
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
            onSubmit={(event) => void createStocktake(event)}
            submitLabel="Create stocktake"
          >
            <SelectField
              label="Site"
              value={stocktake.siteId}
              onChange={setValue(setStocktake, "siteId")}
              options={referenceOptions(references.sites, ["code", "name"])}
              required
            />
            <SelectField
              label="Storage location"
              value={stocktake.storageLocationId}
              onChange={setValue(setStocktake, "storageLocationId")}
              options={referenceOptions(
                references.locations.filter((row) => text(row.siteId) === stocktake.siteId),
                ["code", "name"],
              )}
              required
            />
            <Field label="Notes" value={stocktake.notes} onChange={setValue(setStocktake, "notes")} />
            <div className="line-list">
              {stocktakeLines.map((line, index) => (
                <div className="line-card" key={index}>
                  <div className="line-card-header">
                    <strong>
                      {translateText("Line")} {index + 1}
                    </strong>
                    {stocktakeLines.length > 1 ? (
                      <button
                        className="danger-button small"
                        type="button"
                        onClick={() => removeLine(setStocktakeLines, index)}
                      >
                        {translateText("Remove line")}
                      </button>
                    ) : null}
                  </div>
                  <SelectField
                    label="Product batch"
                    value={line.productBatchId}
                    onChange={(value) => updateStocktakeLine(index, value)}
                    options={batchOptions}
                    required
                  />
                </div>
              ))}
            </div>
            <div className="line-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setStocktakeLines((current) => [...current, stocktakeLineInitial()])}
              >
                {translateText("Add line")}
              </button>
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
          onSubmit={(event) => void countStocktakeLines(event)}
          submitLabel="Record count"
        >
          <div className="line-list">
            {countLines.map((line, index) => (
              <div className="line-card" key={index}>
                <div className="line-card-header">
                  <strong>
                    {translateText("Line")} {index + 1}
                  </strong>
                  {countLines.length > 1 ? (
                    <button
                      className="danger-button small"
                      type="button"
                      onClick={() => removeLine(setCountLines, index)}
                    >
                      {translateText("Remove line")}
                    </button>
                  ) : null}
                </div>
                <div className="form-grid">
                  <SelectField
                    label="Stocktake line"
                    value={line.lineId}
                    onChange={(value) => updateCountLine(index, "lineId", value)}
                    options={stocktakeLineOptions}
                    required
                  />
                  <Field
                    label="Counted quantity"
                    type="number"
                    value={line.countedQuantity}
                    onChange={(value) => updateCountLine(index, "countedQuantity", value)}
                    required
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="line-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => setCountLines((current) => [...current, countLineInitial()])}
            >
              {translateText("Add line")}
            </button>
          </div>
        </FormCard>
      ) : null}
      {tab === "Returns" ? (
        <>
          <DataTable
            rows={returns}
            columns={[
              { key: "id", label: "Return" },
              { key: "siteId", label: "Site" },
              { key: "reason", label: "Reason" },
              {
                key: "status",
                label: "Status",
                render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
              },
              { key: "createdAt", label: "Created" },
            ]}
          />
          <FormCard
            title="Record return or removal"
            onSubmit={(event) => void createReturn(event)}
            submitLabel="Record return"
          >
            <SelectField
              label="Site"
              value={returnForm.siteId}
              onChange={setValue(setReturnForm, "siteId")}
              options={referenceOptions(references.sites, ["code", "name"])}
              required
            />
            <Field label="Reason" value={returnForm.reason} onChange={setValue(setReturnForm, "reason")} required />
            <Field
              label="Destination"
              value={returnForm.destination}
              onChange={setValue(setReturnForm, "destination")}
            />
            <Field
              label="Occurred at"
              type="datetime-local"
              value={returnForm.occurredAtUtc}
              onChange={setValue(setReturnForm, "occurredAtUtc")}
            />
            <div className="line-list">
              {returnLines.map((line, index) => (
                <div className="line-card" key={index}>
                  <div className="line-card-header">
                    <strong>
                      {translateText("Line")} {index + 1}
                    </strong>
                    {returnLines.length > 1 ? (
                      <button
                        className="danger-button small"
                        type="button"
                        onClick={() => removeLine(setReturnLines, index)}
                      >
                        {translateText("Remove line")}
                      </button>
                    ) : null}
                  </div>
                  <div className="form-grid">
                    <SelectField
                      label="Product batch"
                      value={line.productBatchId}
                      onChange={(value) => updateReturnLine(index, "productBatchId", value)}
                      options={batchOptions}
                      required
                    />
                    <SelectField
                      label="Storage location"
                      value={line.storageLocationId}
                      onChange={(value) => updateReturnLine(index, "storageLocationId", value)}
                      options={referenceOptions(
                        references.locations.filter((row) => text(row.siteId) === returnForm.siteId),
                        ["code", "name"],
                      )}
                      required
                    />
                    <Field
                      label="Quantity"
                      type="number"
                      value={line.quantity}
                      onChange={(value) => updateReturnLine(index, "quantity", value)}
                      required
                    />
                    <Field
                      label="Line destination"
                      value={line.destination}
                      onChange={(value) => updateReturnLine(index, "destination", value)}
                    />
                    <Field
                      label="Line notes"
                      value={line.notes}
                      onChange={(value) => updateReturnLine(index, "notes", value)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="line-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setReturnLines((current) => [...current, returnLineInitial()])}
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
            rows={replenishments}
            columns={[
              { key: "id", label: "Request" },
              { key: "productId", label: "Product" },
              { key: "siteId", label: "Site" },
              { key: "requestedQuantity", label: "Quantity" },
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
            onSubmit={(event) => void createReplenishment(event)}
            submitLabel="Request stock"
          >
            <SelectField
              label="Site"
              value={replenish.siteId}
              onChange={setValue(setReplenish, "siteId")}
              options={referenceOptions(references.sites, ["code", "name"])}
              required
            />
            <SelectField
              label="Storage location"
              value={replenish.storageLocationId}
              onChange={setValue(setReplenish, "storageLocationId")}
              options={referenceOptions(
                references.locations.filter((row) => text(row.siteId) === replenish.siteId),
                ["code", "name"],
              )}
              required
            />
            <div className="line-list">
              {replenishmentLines.map((line, index) => (
                <div className="line-card" key={index}>
                  <div className="line-card-header">
                    <strong>
                      {translateText("Line")} {index + 1}
                    </strong>
                    {replenishmentLines.length > 1 ? (
                      <button
                        className="danger-button small"
                        type="button"
                        onClick={() => removeLine(setReplenishmentLines, index)}
                      >
                        {translateText("Remove line")}
                      </button>
                    ) : null}
                  </div>
                  <div className="form-grid">
                    <SelectField
                      label="Product"
                      value={line.productId}
                      onChange={(value) => updateReplenishmentLine(index, "productId", value)}
                      options={productOptions}
                      required
                    />
                    <SelectField
                      label="Product batch"
                      value={line.productBatchId}
                      onChange={(value) => updateReplenishmentLine(index, "productBatchId", value)}
                      options={referenceOptions(
                        references.batches.filter((row) => text(row.productId) === line.productId),
                        ["batchNumber"],
                      )}
                      required
                    />
                    <Field
                      label="Requested quantity"
                      type="number"
                      value={line.requestedQuantity}
                      onChange={(value) => updateReplenishmentLine(index, "requestedQuantity", value)}
                      required
                    />
                    <Field
                      label="Reason"
                      value={line.reason}
                      onChange={(value) => updateReplenishmentLine(index, "reason", value)}
                    />
                    <Field
                      label="Line notes"
                      value={line.notes}
                      onChange={(value) => updateReplenishmentLine(index, "notes", value)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="line-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setReplenishmentLines((current) => [...current, replenishmentLineInitial()])}
              >
                {translateText("Add line")}
              </button>
            </div>
            <Field label="Notes" value={replenish.notes} onChange={setValue(setReplenish, "notes")} />
          </FormCard>
        </>
      ) : null}
    </section>
  );
};
