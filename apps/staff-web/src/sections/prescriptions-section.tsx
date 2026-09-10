import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { readOne, readRows, text, writeJson, type JsonRecord } from "../staff-api.ts";

type PrescriptionLine = {
  productId: string;
  productUnitId: string;
  prescribedQuantity: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes: string;
};
type DispenseLine = { prescriptionLineId: string; productBatchId: string; dispensedQuantity: string };

const initial = {
  siteId: "",
  storageLocationId: "",
  patientName: "",
  patientPhone: "",
  doctorName: "",
  doctorLicense: "",
  notes: "",
};
const prescriptionLineInitial = (): PrescriptionLine => ({
  productId: "",
  productUnitId: "",
  prescribedQuantity: "1",
  dosage: "",
  frequency: "",
  duration: "",
  notes: "",
});
const dispenseLineInitial = (): DispenseLine => ({
  prescriptionLineId: "",
  productBatchId: "",
  dispensedQuantity: "1",
});

export const PrescriptionsSection = ({
  initialTab = "Prescriptions",
}: {
  initialTab?: "Prescriptions" | "Create" | "Dispense" | "Counter transactions";
}): React.JSX.Element => {
  const [tab, setTab] = useState<string>(initialTab);
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [transactions, setTransactions] = useState<JsonRecord[]>([]);
  const [invoices, setInvoices] = useState<JsonRecord[]>([]);
  const [form, setForm] = useState(initial);
  const [prescriptionLines, setPrescriptionLines] = useState<PrescriptionLine[]>([prescriptionLineInitial()]);
  const [dispenseLines, setDispenseLines] = useState<DispenseLine[]>([dispenseLineInitial()]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [unitsByProduct, setUnitsByProduct] = useState<Record<string, JsonRecord[]>>({});
  const [selectedPrescriptionLines, setSelectedPrescriptionLines] = useState<JsonRecord[]>([]);
  const references = useStaffReferences();

  const load = async (): Promise<void> => {
    try {
      setError(undefined);
      const [prescriptions, counter, nextInvoices] = await Promise.all([
        readRows("/api/prescriptions?limit=100"),
        readRows("/api/counter-transactions?limit=100"),
        readRows("/api/payments/invoices"),
      ]);
      setRows(prescriptions);
      setTransactions(counter);
      setInvoices(nextInvoices);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load prescriptions");
    }
  };

  useMountEffect(() => {
    void load();
  });

  const updateForm = (key: keyof typeof form, value: string): void =>
    setForm((current) => ({ ...current, [key]: value }));
  const updatePrescriptionLine = (index: number, key: keyof PrescriptionLine, value: string): void =>
    setPrescriptionLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const updateDispenseLine = (index: number, key: keyof DispenseLine, value: string): void =>
    setDispenseLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const removeLine = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number): void =>
    setter((current) => (current.length <= 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));

  const chooseProductLine = async (index: number, value: string): Promise<void> => {
    updatePrescriptionLine(index, "productId", value);
    updatePrescriptionLine(index, "productUnitId", "");
    if (!value || unitsByProduct[value]) return;
    try {
      const units = await readRows(`/api/products/${value}/units`);
      setUnitsByProduct((current) => ({ ...current, [value]: units }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load product units");
    }
  };

  const selectPrescription = async (id: string): Promise<void> => {
    if (!id) return;
    setSelectedId(id);
    setTab("Dispense");
    try {
      const detail = await readOne<JsonRecord>(`/api/prescriptions/${id}`);
      const lines = Array.isArray(detail.lines)
        ? detail.lines.filter((item): item is JsonRecord => typeof item === "object" && item !== null)
        : [];
      setSelectedPrescriptionLines(lines);
      setDispenseLines(
        lines.map((line) => ({
          prescriptionLineId: text(line.id),
          productBatchId: "",
          dispensedQuantity: text(line.prescribedQuantity, "1"),
        })),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load prescription details");
    }
  };

  const create = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await writeJson("/api/prescriptions", "POST", {
        siteId: form.siteId,
        storageLocationId: form.storageLocationId,
        patientName: form.patientName,
        patientPhone: form.patientPhone || null,
        doctorName: form.doctorName || null,
        doctorLicense: form.doctorLicense || null,
        notes: form.notes || null,
        lines: prescriptionLines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          prescribedQuantity: Number(line.prescribedQuantity),
          dosage: line.dosage || null,
          frequency: line.frequency || null,
          duration: line.duration || null,
          notes: line.notes || null,
        })),
      });
      setForm(initial);
      setPrescriptionLines([prescriptionLineInitial()]);
      setMessage("Prescription created and stock reservation requested.");
      setError(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create prescription");
    }
  };

  const cancel = async (id: string): Promise<void> => {
    try {
      await writeJson(`/api/prescriptions/${id}/cancel`, "POST");
      setMessage("Prescription cancelled.");
      setError(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to cancel prescription");
    }
  };
  const createInvoice = async (prescriptionId: string): Promise<void> => {
    try {
      await writeJson(`/api/payments/prescriptions/${prescriptionId}`, "POST");
      setMessage("Counter invoice created.");
      setError(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create counter invoice");
    }
  };
  const confirmCash = async (invoiceId: string): Promise<void> => {
    try {
      await writeJson(`/api/payments/${invoiceId}/confirm-counter`, "POST");
      setMessage("Counter payment confirmed.");
      setError(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to confirm counter payment");
    }
  };
  const refund = async (invoiceId: string): Promise<void> => {
    const reasonText = window.prompt(translateText("Refund reason:"), translateText("Customer request"));
    if (!reasonText) return;
    try {
      await writeJson(`/api/payments/${invoiceId}/refund`, "POST", { reason: reasonText });
      setMessage("Payment refunded.");
      setError(undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to refund payment");
    }
  };
  const dispensePrescription = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedId) return;
    try {
      await writeJson(`/api/prescriptions/${selectedId}/dispense`, "POST", {
        lines: dispenseLines.map((line) => ({
          prescriptionLineId: line.prescriptionLineId,
          productBatchId: line.productBatchId,
          dispensedQuantity: Number(line.dispensedQuantity),
        })),
      });
      setMessage("Prescription dispensed.");
      setError(undefined);
      setSelectedId("");
      setSelectedPrescriptionLines([]);
      setDispenseLines([dispenseLineInitial()]);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to dispense prescription");
    }
  };

  const productOptions = referenceOptions(references.products, ["sku", "name"]);

  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h2>{translateText("Prescriptions and counter sales")}</h2>
          <p className="page-subtitle">{translateText("Create, reserve, dispense, and cancel prescriptions.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {error ? <p className="notice">{translateText(error)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs tabs={["Prescriptions", "Create", "Dispense", "Counter transactions"]} active={tab} onChange={setTab} />
      {tab === "Prescriptions" ? (
        <DataTable
          rows={rows}
          columns={[
            { key: "patientName", label: "Patient" },
            {
              key: "status",
              label: "Status",
              render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
            },
            { key: "siteId", label: "Site" },
            { key: "createdAt", label: "Created", render: (row) => new Date(text(row.createdAt)).toLocaleString() },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <button className="danger-button" type="button" onClick={() => void cancel(text(row.id))}>
                    {translateText("Cancel")}
                  </button>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => void selectPrescription(text(row.id))}
                  >
                    {translateText("Dispense")}
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Create" ? (
        <FormCard title="Create prescription" onSubmit={(event) => void create(event)} submitLabel="Create and reserve">
          <SelectField
            label="Site"
            value={form.siteId}
            onChange={(value) => updateForm("siteId", value)}
            options={referenceOptions(references.sites, ["code", "name"])}
            required
          />
          <SelectField
            label="Storage location"
            value={form.storageLocationId}
            onChange={(value) => updateForm("storageLocationId", value)}
            options={referenceOptions(references.locations, ["code", "name"])}
            required
          />
          <Field
            label="Patient name"
            value={form.patientName}
            onChange={(value) => updateForm("patientName", value)}
            required
          />
          <Field
            label="Patient phone"
            value={form.patientPhone}
            onChange={(value) => updateForm("patientPhone", value)}
          />
          <Field label="Doctor name" value={form.doctorName} onChange={(value) => updateForm("doctorName", value)} />
          <Field
            label="Doctor license"
            value={form.doctorLicense}
            onChange={(value) => updateForm("doctorLicense", value)}
          />
          <div className="line-list">
            {prescriptionLines.map((line, index) => (
              <div className="line-card" key={index}>
                <div className="line-card-header">
                  <strong>
                    {translateText("Line")} {index + 1}
                  </strong>
                  {prescriptionLines.length > 1 ? (
                    <button
                      className="danger-button small"
                      type="button"
                      onClick={() => removeLine(setPrescriptionLines, index)}
                    >
                      {translateText("Remove line")}
                    </button>
                  ) : null}
                </div>
                <div className="form-grid">
                  <SelectField
                    label="Product"
                    value={line.productId}
                    onChange={(value) => void chooseProductLine(index, value)}
                    options={productOptions}
                    required
                  />
                  <SelectField
                    label="Product unit"
                    value={line.productUnitId}
                    onChange={(value) => updatePrescriptionLine(index, "productUnitId", value)}
                    options={referenceOptions(unitsByProduct[line.productId] ?? [], ["unitName"])}
                    required
                  />
                  <Field
                    label="Quantity"
                    type="number"
                    value={line.prescribedQuantity}
                    onChange={(value) => updatePrescriptionLine(index, "prescribedQuantity", value)}
                    required
                  />
                  <Field
                    label="Dosage"
                    value={line.dosage}
                    onChange={(value) => updatePrescriptionLine(index, "dosage", value)}
                  />
                  <Field
                    label="Frequency"
                    value={line.frequency}
                    onChange={(value) => updatePrescriptionLine(index, "frequency", value)}
                  />
                  <Field
                    label="Duration"
                    value={line.duration}
                    onChange={(value) => updatePrescriptionLine(index, "duration", value)}
                  />
                  <Field
                    label="Line notes"
                    value={line.notes}
                    onChange={(value) => updatePrescriptionLine(index, "notes", value)}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="line-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => setPrescriptionLines((current) => [...current, prescriptionLineInitial()])}
            >
              {translateText("Add line")}
            </button>
          </div>
          <Field label="Notes" value={form.notes} onChange={(value) => updateForm("notes", value)} />
        </FormCard>
      ) : null}
      {tab === "Dispense" ? (
        <FormCard
          title="Dispense prescription"
          onSubmit={(event) => void dispensePrescription(event)}
          submitLabel="Dispense"
        >
          <SelectField
            label="Prescription"
            value={selectedId}
            onChange={(value) => void selectPrescription(value)}
            options={referenceOptions(rows, ["patientName", "status"])}
            required
          />
          <div className="line-list">
            {dispenseLines.map((line, index) => {
              const prescriptionLine = selectedPrescriptionLines.find(
                (value) => text(value.id) === line.prescriptionLineId,
              );
              const productId = text(prescriptionLine?.productId);
              return (
                <div className="line-card" key={index}>
                  <div className="line-card-header">
                    <strong>
                      {translateText("Line")} {index + 1}
                    </strong>
                  </div>
                  <div className="form-grid">
                    <SelectField
                      label="Prescription line"
                      value={line.prescriptionLineId}
                      onChange={(value) => updateDispenseLine(index, "prescriptionLineId", value)}
                      options={referenceOptions(selectedPrescriptionLines, ["productId", "prescribedQuantity"])}
                      required
                    />
                    <SelectField
                      label="Product batch"
                      value={line.productBatchId}
                      onChange={(value) => updateDispenseLine(index, "productBatchId", value)}
                      options={referenceOptions(
                        references.batches.filter((batch) => text(batch.productId) === productId),
                        ["batchNumber"],
                      )}
                      required
                    />
                    <Field
                      label="Dispensed quantity"
                      type="number"
                      value={line.dispensedQuantity}
                      onChange={(value) => updateDispenseLine(index, "dispensedQuantity", value)}
                      required
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </FormCard>
      ) : null}
      {tab === "Counter transactions" ? (
        <DataTable
          rows={invoices.length > 0 ? invoices : transactions}
          columns={[
            { key: "paymentCode", label: "Invoice" },
            { key: "prescriptionId", label: "Prescription" },
            {
              key: "status",
              label: "Payment",
              render: (row) => (
                <span className="status-chip">
                  {translateText(text(row.status ?? row.paymentStatus, "Not invoiced"))}
                </span>
              ),
            },
            { key: "amount", label: "Amount" },
            { key: "createdAt", label: "Created" },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  {text(row.status, "") === "" ? (
                    <button
                      className="primary-button small"
                      type="button"
                      onClick={() => void createInvoice(text(row.prescriptionId ?? row.id))}
                    >
                      {translateText("Create invoice")}
                    </button>
                  ) : null}
                  {text(row.status) === "Pending" ? (
                    <button
                      className="primary-button small"
                      type="button"
                      onClick={() => void confirmCash(text(row.id))}
                    >
                      {translateText("Confirm cash")}
                    </button>
                  ) : null}
                  {text(row.status) === "Paid" ? (
                    <button className="danger-button" type="button" onClick={() => void refund(text(row.id))}>
                      {translateText("Refund")}
                    </button>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      ) : null}
    </section>
  );
};
