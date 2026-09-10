import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { action, readOne, readRows, text, writeJson, type JsonRecord } from "../staff-api.ts";

type PurchaseOrderLine = { productId: string; orderedQuantity: string; notes: string };
type ReceiptLine = {
  productId: string;
  batchNumber: string;
  expiryDate: string;
  manufacturedDate: string;
  manufacturer: string;
  quantity: string;
  notes: string;
};

const poInitial = { purchaseOrderNumber: "", supplierId: "", siteId: "", expectedDate: "", notes: "" };
const poLineInitial = (): PurchaseOrderLine => ({ productId: "", orderedQuantity: "1", notes: "" });
const receiptInitial = {
  receiptNumber: "",
  supplierId: "",
  siteId: "",
  storageLocationId: "",
  purchaseOrderId: "",
  notes: "",
};
const receiptLineInitial = (): ReceiptLine => ({
  productId: "",
  batchNumber: "",
  expiryDate: "",
  manufacturedDate: "",
  manufacturer: "",
  quantity: "1",
  notes: "",
});

export const ProcurementSection = ({
  initialTab = "Purchase orders",
}: {
  initialTab?: "Purchase orders" | "Create order" | "Goods receipts" | "Receive goods";
}): React.JSX.Element => {
  const [tab, setTab] = useState<string>(initialTab);
  const [orders, setOrders] = useState<JsonRecord[]>([]);
  const [receipts, setReceipts] = useState<JsonRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<JsonRecord>();
  const [selectedReceipt, setSelectedReceipt] = useState<JsonRecord>();
  const [po, setPo] = useState(poInitial);
  const [poLines, setPoLines] = useState<PurchaseOrderLine[]>([poLineInitial()]);
  const [receipt, setReceipt] = useState(receiptInitial);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([receiptLineInitial()]);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();

  const load = async (): Promise<void> => {
    try {
      setError(undefined);
      const [nextOrders, nextReceipts] = await Promise.all([
        readRows("/api/procurement/purchase-orders"),
        readRows("/api/procurement/goods-receipts"),
      ]);
      setOrders(nextOrders);
      setReceipts(nextReceipts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load procurement");
    }
  };

  useMountEffect(() => {
    void load();
  });

  const setPoValue =
    (key: keyof typeof po) =>
    (value: string): void =>
      setPo((current) => ({ ...current, [key]: value }));
  const setReceiptValue =
    (key: keyof typeof receipt) =>
    (value: string): void =>
      setReceipt((current) => ({ ...current, [key]: value }));
  const updatePoLine = (index: number, key: keyof PurchaseOrderLine, value: string): void =>
    setPoLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)));
  const updateReceiptLine = (index: number, key: keyof ReceiptLine, value: string): void =>
    setReceiptLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const removeLine = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number): void =>
    setter((current) => (current.length <= 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));

  const createPo = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await writeJson("/api/procurement/purchase-orders", "POST", {
        purchaseOrderNumber: po.purchaseOrderNumber || undefined,
        supplierId: po.supplierId,
        siteId: po.siteId,
        expectedDate: po.expectedDate || undefined,
        notes: po.notes || undefined,
        lines: poLines.map((line) => ({
          productId: line.productId,
          orderedQuantity: Number(line.orderedQuantity),
          notes: line.notes || undefined,
        })),
      });
      setPo(poInitial);
      setPoLines([poLineInitial()]);
      setMessage("Purchase order created.");
      setError(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create purchase order");
    }
  };

  const createReceipt = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await writeJson("/api/procurement/goods-receipts", "POST", {
        receiptNumber: receipt.receiptNumber,
        supplierId: receipt.supplierId,
        siteId: receipt.siteId,
        storageLocationId: receipt.storageLocationId,
        purchaseOrderId: receipt.purchaseOrderId || undefined,
        notes: receipt.notes || undefined,
        receivedAt: new Date().toISOString(),
        lines: receiptLines.map((line) => ({
          productId: line.productId,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
          manufacturedDate: line.manufacturedDate || undefined,
          manufacturer: line.manufacturer || undefined,
          quantity: Number(line.quantity),
          notes: line.notes || undefined,
        })),
      });
      setReceipt(receiptInitial);
      setReceiptLines([receiptLineInitial()]);
      setMessage("Goods receipt created.");
      setError(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create goods receipt");
    }
  };

  const viewOrder = async (id: string): Promise<void> => {
    try {
      setSelectedOrder(await readOne<JsonRecord>(`/api/procurement/purchase-orders/${id}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load purchase order");
    }
  };
  const viewReceipt = async (id: string): Promise<void> => {
    try {
      setSelectedReceipt(await readOne<JsonRecord>(`/api/procurement/goods-receipts/${id}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load goods receipt");
    }
  };
  const transition = async (id: string, value: "approve" | "cancel"): Promise<void> => {
    try {
      await action(`/api/procurement/purchase-orders/${id}/action`, value);
      setMessage(`Purchase order ${value}d.`);
      setError(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to transition purchase order");
    }
  };

  const productOptions = referenceOptions(references.products, ["sku", "name"]);

  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h2>{translateText("Procurement and receiving")}</h2>
          <p className="page-subtitle">{translateText("Manage purchase orders and receive supplier stock.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {error ? <p className="notice">{translateText(error)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs
        tabs={["Purchase orders", "Create order", "Goods receipts", "Receive goods"]}
        active={tab}
        onChange={setTab}
      />
      {tab === "Purchase orders" ? (
        <>
          <DataTable
            rows={orders}
            columns={[
              { key: "purchaseOrderNumber", label: "Number" },
              {
                key: "status",
                label: "Status",
                render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
              },
              { key: "siteId", label: "Site" },
              { key: "supplierId", label: "Supplier" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <span className="row-actions">
                    <button className="ghost-button small" type="button" onClick={() => void viewOrder(text(row.id))}>
                      {translateText("View")}
                    </button>
                    <button
                      className="primary-button small"
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
                  </span>
                ),
              },
            ]}
          />
          {selectedOrder ? (
            <div className="detail-panel">
              <h3>{translateText("Purchase order details")}</h3>
              <p>
                {text(selectedOrder.purchaseOrderNumber)} · {translateText(text(selectedOrder.status))}
              </p>
              <DataTable
                rows={
                  Array.isArray(selectedOrder.lines)
                    ? selectedOrder.lines.filter(
                        (value): value is JsonRecord => typeof value === "object" && value !== null,
                      )
                    : []
                }
                columns={[
                  { key: "productId", label: "Product" },
                  { key: "orderedQuantity", label: "Ordered" },
                  { key: "receivedQuantity", label: "Received" },
                  { key: "notes", label: "Notes" },
                ]}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {tab === "Create order" ? (
        <FormCard title="Create purchase order" onSubmit={(event) => void createPo(event)} submitLabel="Create order">
          <Field
            label="Purchase order number"
            value={po.purchaseOrderNumber}
            onChange={setPoValue("purchaseOrderNumber")}
          />
          <SelectField
            label="Supplier"
            value={po.supplierId}
            onChange={setPoValue("supplierId")}
            options={referenceOptions(references.suppliers, ["code", "name"])}
            required
          />
          <SelectField
            label="Site"
            value={po.siteId}
            onChange={setPoValue("siteId")}
            options={referenceOptions(references.sites, ["code", "name"])}
            required
          />
          <Field label="Expected date" type="date" value={po.expectedDate} onChange={setPoValue("expectedDate")} />
          <div className="line-list">
            {poLines.map((line, index) => (
              <div className="line-card" key={index}>
                <div className="line-card-header">
                  <strong>
                    {translateText("Line")} {index + 1}
                  </strong>
                  {poLines.length > 1 ? (
                    <button className="danger-button small" type="button" onClick={() => removeLine(setPoLines, index)}>
                      {translateText("Remove line")}
                    </button>
                  ) : null}
                </div>
                <div className="form-grid">
                  <SelectField
                    label="Product"
                    value={line.productId}
                    onChange={(value) => updatePoLine(index, "productId", value)}
                    options={productOptions}
                    required
                  />
                  <Field
                    label="Ordered quantity"
                    type="number"
                    value={line.orderedQuantity}
                    onChange={(value) => updatePoLine(index, "orderedQuantity", value)}
                    required
                  />
                  <Field
                    label="Line notes"
                    value={line.notes}
                    onChange={(value) => updatePoLine(index, "notes", value)}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="line-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => setPoLines((current) => [...current, poLineInitial()])}
            >
              {translateText("Add line")}
            </button>
          </div>
          <Field label="Notes" value={po.notes} onChange={setPoValue("notes")} />
        </FormCard>
      ) : null}
      {tab === "Goods receipts" ? (
        <>
          <DataTable
            rows={receipts}
            columns={[
              { key: "receiptNumber", label: "Receipt" },
              {
                key: "status",
                label: "Status",
                render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
              },
              { key: "siteId", label: "Site" },
              { key: "receivedAt", label: "Received" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <button className="ghost-button small" type="button" onClick={() => void viewReceipt(text(row.id))}>
                    {translateText("View")}
                  </button>
                ),
              },
            ]}
          />
          {selectedReceipt ? (
            <div className="detail-panel">
              <h3>{translateText("Goods receipt details")}</h3>
              <p>
                {text(selectedReceipt.receiptNumber)} · {text(selectedReceipt.notes)}
              </p>
              <DataTable
                rows={
                  Array.isArray(selectedReceipt.lines)
                    ? selectedReceipt.lines.filter(
                        (value): value is JsonRecord => typeof value === "object" && value !== null,
                      )
                    : []
                }
                columns={[
                  { key: "productId", label: "Product" },
                  { key: "batchNumber", label: "Batch" },
                  { key: "manufacturedDate", label: "Manufactured" },
                  { key: "manufacturer", label: "Manufacturer" },
                  { key: "quantity", label: "Quantity" },
                  { key: "notes", label: "Notes" },
                ]}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {tab === "Receive goods" ? (
        <FormCard
          title="Create goods receipt"
          onSubmit={(event) => void createReceipt(event)}
          submitLabel="Receive goods"
        >
          <Field
            label="Receipt number"
            value={receipt.receiptNumber}
            onChange={setReceiptValue("receiptNumber")}
            required
          />
          <SelectField
            label="Supplier"
            value={receipt.supplierId}
            onChange={setReceiptValue("supplierId")}
            options={referenceOptions(references.suppliers, ["code", "name"])}
            required
          />
          <SelectField
            label="Site"
            value={receipt.siteId}
            onChange={setReceiptValue("siteId")}
            options={referenceOptions(references.sites, ["code", "name"])}
            required
          />
          <SelectField
            label="Storage location"
            value={receipt.storageLocationId}
            onChange={setReceiptValue("storageLocationId")}
            options={referenceOptions(
              references.locations.filter((row) => text(row.siteId) === receipt.siteId),
              ["code", "name"],
            )}
            required
          />
          <SelectField
            label="Purchase order (optional)"
            value={receipt.purchaseOrderId}
            onChange={setReceiptValue("purchaseOrderId")}
            options={referenceOptions(orders, ["purchaseOrderNumber"])}
          />
          <Field label="Notes" value={receipt.notes} onChange={setReceiptValue("notes")} />
          <div className="line-list">
            {receiptLines.map((line, index) => (
              <div className="line-card" key={index}>
                <div className="line-card-header">
                  <strong>
                    {translateText("Line")} {index + 1}
                  </strong>
                  {receiptLines.length > 1 ? (
                    <button
                      className="danger-button small"
                      type="button"
                      onClick={() => removeLine(setReceiptLines, index)}
                    >
                      {translateText("Remove line")}
                    </button>
                  ) : null}
                </div>
                <div className="form-grid">
                  <SelectField
                    label="Product"
                    value={line.productId}
                    onChange={(value) => updateReceiptLine(index, "productId", value)}
                    options={productOptions}
                    required
                  />
                  <Field
                    label="Batch number"
                    value={line.batchNumber}
                    onChange={(value) => updateReceiptLine(index, "batchNumber", value)}
                    required
                  />
                  <Field
                    label="Expiry date"
                    type="date"
                    value={line.expiryDate}
                    onChange={(value) => updateReceiptLine(index, "expiryDate", value)}
                    required
                  />
                  <Field
                    label="Manufactured date"
                    type="date"
                    value={line.manufacturedDate}
                    onChange={(value) => updateReceiptLine(index, "manufacturedDate", value)}
                  />
                  <Field
                    label="Manufacturer"
                    value={line.manufacturer}
                    onChange={(value) => updateReceiptLine(index, "manufacturer", value)}
                  />
                  <Field
                    label="Quantity"
                    type="number"
                    value={line.quantity}
                    onChange={(value) => updateReceiptLine(index, "quantity", value)}
                    required
                  />
                  <Field
                    label="Line notes"
                    value={line.notes}
                    onChange={(value) => updateReceiptLine(index, "notes", value)}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="line-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => setReceiptLines((current) => [...current, receiptLineInitial()])}
            >
              {translateText("Add line")}
            </button>
          </div>
        </FormCard>
      ) : null}
    </section>
  );
};
