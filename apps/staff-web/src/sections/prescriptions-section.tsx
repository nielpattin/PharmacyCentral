import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import { referenceLabel, referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { useStaffMutation } from "../hooks/useStaffMutation.ts";
import { formatDateTime, readOne, readRows, text, type JsonRecord } from "../staff-api.ts";

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
  customerId: "",
  doctorName: "",
  doctorLicense: "",
  notes: "",
};
const dispenseInitial = { prescriptionId: "" };
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
  const prescriptionsQuery = useQuery({
    queryKey: ["prescriptions"],
    queryFn: async () => {
      const [rows, transactions, invoices] = await Promise.all([
        readRows("/api/prescriptions?limit=100"),
        readRows("/api/counter-transactions?limit=100"),
        readRows("/api/payments/invoices"),
      ]);
      return { rows, transactions, invoices };
    },
  });
  const rows = prescriptionsQuery.data?.rows ?? [];
  const transactions = prescriptionsQuery.data?.transactions ?? [];
  const invoices = prescriptionsQuery.data?.invoices ?? [];
  // An online order carries the order it was raised for; those invoices belong to the orders screen, not the counter.
  const counterInvoices = invoices.filter((invoice) => !invoice.orderId);
  const [prescriptionLines, setPrescriptionLines] = useState<PrescriptionLine[]>([prescriptionLineInitial()]);
  const [dispenseLines, setDispenseLines] = useState<DispenseLine[]>([dispenseLineInitial()]);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [unitsByProduct, setUnitsByProduct] = useState<Record<string, JsonRecord[]>>({});
  const [selectedPrescriptionLines, setSelectedPrescriptionLines] = useState<JsonRecord[]>([]);
  const references = useStaffReferences();
  const mutation = useStaffMutation();

  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const result = await prescriptionsQuery.refetch();
      if (result.error) throw result.error;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load prescriptions");
    }
  };
  const visibleError =
    error ?? (prescriptionsQuery.error instanceof Error ? prescriptionsQuery.error.message : undefined);

  const prescriptionForm = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({
          path: "/api/prescriptions",
          method: "POST",
          body: {
            siteId: value.siteId,
            storageLocationId: value.storageLocationId,
            patientName: value.patientName,
            patientPhone: value.patientPhone || null,
            doctorName: value.doctorName || null,
            doctorLicense: value.doctorLicense || null,
            notes: value.notes || null,
            customerId: value.customerId || null,
            lines: prescriptionLines.map((line) => ({
              productId: line.productId,
              productUnitId: line.productUnitId,
              prescribedQuantity: Number(line.prescribedQuantity),
              dosage: line.dosage || null,
              frequency: line.frequency || null,
              duration: line.duration || null,
              notes: line.notes || null,
            })),
          },
          invalidate: [["prescriptions"]],
        });
        prescriptionForm.reset(initial);
        setPrescriptionLines([prescriptionLineInitial()]);
        setMessage("Prescription created and stock reservation requested.");
        setError(undefined);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to create prescription");
      }
    },
  });

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
    dispenseForm.setFieldValue("prescriptionId", id);
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

  const cancel = async (id: string): Promise<void> => {
    try {
      await mutation.mutateAsync({
        path: `/api/prescriptions/${id}/cancel`,
        method: "POST",
        invalidate: [["prescriptions"]],
      });
      setMessage("Prescription cancelled.");
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to cancel prescription");
    }
  };
  const createInvoice = async (prescriptionId: string): Promise<void> => {
    try {
      await mutation.mutateAsync({
        path: `/api/payments/prescriptions/${prescriptionId}`,
        method: "POST",
        invalidate: [["prescriptions"]],
      });
      setMessage("Counter invoice created.");
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create counter invoice");
    }
  };
  const confirmCash = async (invoiceId: string): Promise<void> => {
    try {
      await mutation.mutateAsync({
        path: `/api/payments/${invoiceId}/confirm-counter`,
        method: "POST",
        invalidate: [["prescriptions"]],
      });
      setMessage("Counter payment confirmed.");
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to confirm counter payment");
    }
  };
  const refund = async (invoiceId: string): Promise<void> => {
    const reasonText = window.prompt(translateText("Refund reason:"), translateText("Customer request"));
    if (!reasonText) return;
    try {
      await mutation.mutateAsync({
        path: `/api/payments/${invoiceId}/refund`,
        method: "POST",
        body: { reason: reasonText },
        invalidate: [["prescriptions"]],
      });
      setMessage("Payment refunded.");
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to refund payment");
    }
  };
  const dispenseForm = useForm({
    defaultValues: dispenseInitial,
    onSubmit: async ({ value }) => {
      if (!value.prescriptionId) return;
      try {
        await mutation.mutateAsync({
          path: `/api/prescriptions/${value.prescriptionId}/dispense`,
          method: "POST",
          body: {
            lines: dispenseLines.map((line) => ({
              prescriptionLineId: line.prescriptionLineId,
              productBatchId: line.productBatchId,
              dispensedQuantity: Number(line.dispensedQuantity),
            })),
          },
          invalidate: [["prescriptions"]],
        });
        setMessage("Prescription dispensed.");
        setError(undefined);
        dispenseForm.reset(dispenseInitial);
        setSelectedPrescriptionLines([]);
        setDispenseLines([dispenseLineInitial()]);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to dispense prescription");
      }
    },
  });

  const productOptions = referenceOptions(references.products, ["sku", "name"]);

  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h1>{translateText("Prescriptions and counter sales")}</h1>
          <p className="page-subtitle">{translateText("Create, reserve, dispense, and cancel prescriptions.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {visibleError ? <p className="notice">{translateText(visibleError)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs tabs={["Prescriptions", "Create", "Dispense", "Counter transactions"]} active={tab} onChange={setTab} />
      {tab === "Prescriptions" ? (
        <DataTable
          loading={prescriptionsQuery.isPending && !prescriptionsQuery.data}
          rows={rows}
          columns={[
            { key: "patientName", label: "Patient" },
            {
              key: "status",
              label: "Status",
              render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
            },
            {
              key: "siteId",
              label: "Site",
              render: (row) => referenceLabel(references.sites, row.siteId, ["code", "name"]),
            },
            { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
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
        <FormCard
          title="Create prescription"
          onSubmit={(event) => {
            event.preventDefault();
            void prescriptionForm.handleSubmit();
          }}
          submitLabel="Create and reserve"
        >
          <prescriptionForm.Field name="siteId">
            {(field) => (
              <SelectField
                label="Site"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.sites, ["code", "name"])}
                required
              />
            )}
          </prescriptionForm.Field>
          <prescriptionForm.Field name="storageLocationId">
            {(field) => (
              <SelectField
                label="Storage location"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.locations, ["code", "name"])}
                required
              />
            )}
          </prescriptionForm.Field>
          <prescriptionForm.Field name="patientName">
            {(field) => <Field label="Patient name" value={field.state.value} onChange={field.handleChange} required />}
          </prescriptionForm.Field>
          <prescriptionForm.Field name="patientPhone">
            {(field) => <Field label="Patient phone" value={field.state.value} onChange={field.handleChange} />}
          </prescriptionForm.Field>
          <prescriptionForm.Field name="customerId">
            {(field) => (
              <SelectField
                label="Customer account"
                value={field.state.value}
                onChange={(value) => {
                  field.handleChange(value);
                  // Picking the account fills the patient details, so staff never retypes what the account already knows.
                  const customer = references.customers.find((row) => row.id === value);
                  if (customer) {
                    const name = customer.displayName;
                    if (typeof name === "string" && name) prescriptionForm.setFieldValue("patientName", name);
                    const phone = customer.phoneNumber;
                    if (typeof phone === "string" && phone) prescriptionForm.setFieldValue("patientPhone", phone);
                  }
                }}
                options={[
                  { value: "", label: "Không liên kết (khách vãng lai)" },
                  ...referenceOptions(
                    references.customers.filter((row) => row.actorType === "customer"),
                    ["displayName", "email"],
                  ),
                ]}
              />
            )}
          </prescriptionForm.Field>
          <prescriptionForm.Field name="doctorName">
            {(field) => <Field label="Doctor name" value={field.state.value} onChange={field.handleChange} />}
          </prescriptionForm.Field>
          <prescriptionForm.Field name="doctorLicense">
            {(field) => <Field label="Doctor license" value={field.state.value} onChange={field.handleChange} />}
          </prescriptionForm.Field>
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
          <prescriptionForm.Field name="notes">
            {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
          </prescriptionForm.Field>
        </FormCard>
      ) : null}
      {tab === "Dispense" ? (
        <FormCard
          title="Dispense prescription"
          onSubmit={(event) => {
            event.preventDefault();
            void dispenseForm.handleSubmit();
          }}
          submitLabel="Dispense"
        >
          <dispenseForm.Field name="prescriptionId">
            {(field) => (
              <SelectField
                label="Prescription"
                value={field.state.value}
                onChange={(value) => void selectPrescription(value)}
                options={referenceOptions(rows, ["patientName", "status"])}
                required
              />
            )}
          </dispenseForm.Field>
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
          loading={prescriptionsQuery.isPending && !prescriptionsQuery.data}
          rows={counterInvoices.length > 0 ? counterInvoices : transactions}
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
            { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
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
