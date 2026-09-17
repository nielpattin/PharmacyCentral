import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { useStaffMutation } from "../hooks/useStaffMutation.ts";
import { readOne, readRows, text, type JsonRecord } from "../staff-api.ts";

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
  const procurementQuery = useQuery({
    queryKey: ["procurement"],
    queryFn: async () => {
      const [orders, receipts] = await Promise.all([
        readRows("/api/procurement/purchase-orders"),
        readRows("/api/procurement/goods-receipts"),
      ]);
      return { orders, receipts };
    },
  });
  const orders = procurementQuery.data?.orders ?? [];
  const receipts = procurementQuery.data?.receipts ?? [];
  const [selectedOrder, setSelectedOrder] = useState<JsonRecord>();
  const [selectedReceipt, setSelectedReceipt] = useState<JsonRecord>();
  const [poLines, setPoLines] = useState<PurchaseOrderLine[]>([poLineInitial()]);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([receiptLineInitial()]);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();
  const mutation = useStaffMutation();

  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const result = await procurementQuery.refetch();
      if (result.error) throw result.error;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load procurement");
    }
  };
  const visibleError = error ?? (procurementQuery.error instanceof Error ? procurementQuery.error.message : undefined);

  const updatePoLine = (index: number, key: keyof PurchaseOrderLine, value: string): void =>
    setPoLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)));
  const updateReceiptLine = (index: number, key: keyof ReceiptLine, value: string): void =>
    setReceiptLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const removeLine = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number): void =>
    setter((current) => (current.length <= 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));

  const poForm = useForm({
    defaultValues: poInitial,
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({
          path: "/api/procurement/purchase-orders",
          method: "POST",
          body: {
            purchaseOrderNumber: value.purchaseOrderNumber || undefined,
            supplierId: value.supplierId,
            siteId: value.siteId,
            expectedDate: value.expectedDate || undefined,
            notes: value.notes || undefined,
            lines: poLines.map((line) => ({
              productId: line.productId,
              orderedQuantity: Number(line.orderedQuantity),
              notes: line.notes || undefined,
            })),
          },
          invalidate: [["procurement"], ["staff-references"]],
        });
        poForm.reset(poInitial);
        setPoLines([poLineInitial()]);
        setMessage("Purchase order created.");
        setError(undefined);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to create purchase order");
      }
    },
  });

  const receiptForm = useForm({
    defaultValues: receiptInitial,
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({
          path: "/api/procurement/goods-receipts",
          method: "POST",
          body: {
            receiptNumber: value.receiptNumber,
            supplierId: value.supplierId,
            siteId: value.siteId,
            storageLocationId: value.storageLocationId,
            purchaseOrderId: value.purchaseOrderId || undefined,
            notes: value.notes || undefined,
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
          },
          invalidate: [["procurement"], ["staff-references"]],
        });
        receiptForm.reset(receiptInitial);
        setReceiptLines([receiptLineInitial()]);
        setMessage("Goods receipt created.");
        setError(undefined);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to create goods receipt");
      }
    },
  });

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
      await mutation.mutateAsync({
        path: `/api/procurement/purchase-orders/${id}/action`,
        method: "POST",
        body: { action: value },
        invalidate: [["procurement"]],
      });
      setMessage(`Purchase order ${value}d.`);
      setError(undefined);
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
      {visibleError ? <p className="notice">{translateText(visibleError)}</p> : null}
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
        <FormCard
          title="Create purchase order"
          onSubmit={(event) => {
            event.preventDefault();
            void poForm.handleSubmit();
          }}
          submitLabel="Create order"
        >
          <poForm.Field name="purchaseOrderNumber">
            {(field) => <Field label="Purchase order number" value={field.state.value} onChange={field.handleChange} />}
          </poForm.Field>
          <poForm.Field name="supplierId">
            {(field) => (
              <SelectField
                label="Supplier"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.suppliers, ["code", "name"])}
                required
              />
            )}
          </poForm.Field>
          <poForm.Field name="siteId">
            {(field) => (
              <SelectField
                label="Site"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.sites, ["code", "name"])}
                required
              />
            )}
          </poForm.Field>
          <poForm.Field name="expectedDate">
            {(field) => (
              <Field label="Expected date" type="date" value={field.state.value} onChange={field.handleChange} />
            )}
          </poForm.Field>
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
          <poForm.Field name="notes">
            {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
          </poForm.Field>
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
          onSubmit={(event) => {
            event.preventDefault();
            void receiptForm.handleSubmit();
          }}
          submitLabel="Receive goods"
        >
          <receiptForm.Field name="receiptNumber">
            {(field) => (
              <Field label="Receipt number" value={field.state.value} onChange={field.handleChange} required />
            )}
          </receiptForm.Field>
          <receiptForm.Field name="supplierId">
            {(field) => (
              <SelectField
                label="Supplier"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.suppliers, ["code", "name"])}
                required
              />
            )}
          </receiptForm.Field>
          <receiptForm.Field name="siteId">
            {(field) => (
              <SelectField
                label="Site"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.sites, ["code", "name"])}
                required
              />
            )}
          </receiptForm.Field>
          <receiptForm.Field name="storageLocationId">
            {(field) => (
              <SelectField
                label="Storage location"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(
                  references.locations.filter((row) => text(row.siteId) === receiptForm.state.values.siteId),
                  ["code", "name"],
                )}
                required
              />
            )}
          </receiptForm.Field>
          <receiptForm.Field name="purchaseOrderId">
            {(field) => (
              <SelectField
                label="Purchase order (optional)"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(orders, ["purchaseOrderNumber"])}
              />
            )}
          </receiptForm.Field>
          <receiptForm.Field name="notes">
            {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
          </receiptForm.Field>
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
