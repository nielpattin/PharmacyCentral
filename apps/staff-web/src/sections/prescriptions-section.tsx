import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field as UiField,
  Input,
  Textarea,
} from "@pharmacy/ui";

import { useSession } from "../auth.ts";
import { DataTable } from "../components/data-table.tsx";
import { EmptyState, Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import { referenceLabel, referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { useStaffMutation } from "../hooks/useStaffMutation.ts";
import {
  ApiProblemError,
  answerPrescriptionConsultation,
  formatDateTime,
  formatQuantity,
  listPrescriptionConsultations,
  lookupCustomers,
  readOne,
  readRows,
  text,
  type JsonRecord,
  type PrescriptionConsultationStatus,
} from "../staff-api.ts";

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

const consultationStatuses: readonly PrescriptionConsultationStatus[] = ["Open", "Answered"];

/** Shown instead of the contract's status names so the queue reads the way a pharmacist speaks about it. */
const consultationStatusLabels: Record<PrescriptionConsultationStatus, string> = {
  Open: "Waiting for answer",
  Answered: "Answered",
};

/** How a looked-up account reads in the picker: whatever of name, email, and phone the account actually holds. */
const customerLabel = (customer: JsonRecord): string => {
  const parts = [text(customer.displayName, ""), text(customer.email, ""), text(customer.phoneNumber, "")];
  return parts.filter((part) => part.length > 0).join(" · ");
};

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
  initialTab?: "Prescriptions" | "Create" | "Dispense" | "Counter transactions" | "Consultations";
}): React.JSX.Element => {
  const [tab, setTab] = useState<string>(initialTab);
  // Dispensing, taking payment and answering a consultation are a licensed pharmacist's work. A Pharmacy Manager
  // supervises the same records read-only, which is what the edge policy grants that role on these routes.
  const roles = useSession().roles ?? [];
  const canOperateCounter = roles.includes("Pharmacist") || roles.includes("Platform Admin");
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
  const [consultationStatus, setConsultationStatus] = useState<PrescriptionConsultationStatus>("Open");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const consultationsQuery = useQuery({
    queryKey: ["prescription-consultations", consultationStatus],
    queryFn: () => listPrescriptionConsultations({ status: consultationStatus }),
  });
  const consultations = consultationsQuery.data ?? [];
  const answerConsultation = useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) => answerPrescriptionConsultation(id, reply),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["prescription-consultations"] });
    },
  });
  const references = useStaffReferences();
  const mutation = useStaffMutation();
  // The customer picker searches identity-service on demand: the account list behind `/api/admin/users` is
  // Platform Admin only, so a Pharmacist would otherwise never see a customer to link.
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMatches, setCustomerMatches] = useState<JsonRecord[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<JsonRecord>();
  const [customerLookupNote, setCustomerLookupNote] = useState<string>();
  const customerLookup = useMutation({
    mutationFn: (query: string) => lookupCustomers(query),
    onSuccess: (matches) => {
      setCustomerMatches(matches);
      setCustomerLookupNote(matches.length > 0 ? undefined : "No customer account matches");
    },
    onError: (reason) => {
      setCustomerMatches([]);
      setCustomerLookupNote(reason instanceof Error ? reason.message : "Unable to look up customers");
    },
  });

  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const results = await Promise.all([prescriptionsQuery.refetch(), consultationsQuery.refetch()]);
      const failure = results.find((result) => result.error)?.error;
      if (failure) throw failure;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load prescriptions");
    }
  };

  const resetCustomerLookup = (): void => {
    setCustomerQuery("");
    setCustomerMatches([]);
    setSelectedCustomer(undefined);
    setCustomerLookupNote(undefined);
  };
  const visibleError =
    error ?? (prescriptionsQuery.error instanceof Error ? prescriptionsQuery.error.message : undefined);
  const consultationsError = consultationsQuery.error instanceof Error ? consultationsQuery.error.message : undefined;

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
        resetCustomerLookup();
        setMessage("Prescription created and stock reservation requested.");
        setError(undefined);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to create prescription");
      }
    },
  });

  const findCustomer = (): void => {
    const query = customerQuery.trim();
    if (query.length < 3) {
      setCustomerMatches([]);
      setCustomerLookupNote("Enter at least 3 characters of the phone or email");
      return;
    }
    void customerLookup.mutateAsync(query).catch(() => undefined);
  };

  const selectCustomer = (customer: JsonRecord): void => {
    prescriptionForm.setFieldValue("customerId", text(customer.id, ""));
    // Picking the account fills the patient details, so staff never retype what the account already knows.
    const name = text(customer.displayName, "");
    if (name) prescriptionForm.setFieldValue("patientName", name);
    const phone = text(customer.phoneNumber, "");
    if (phone) prescriptionForm.setFieldValue("patientPhone", phone);
    setSelectedCustomer(customer);
    setCustomerMatches([]);
    setCustomerLookupNote(undefined);
  };

  const clearCustomer = (): void => {
    prescriptionForm.setFieldValue("customerId", "");
    resetCustomerLookup();
  };

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
  const sendConsultationReply = async (id: string): Promise<void> => {
    const reply = (replyDrafts[id] ?? "").trim();
    if (!reply) return;
    try {
      await answerConsultation.mutateAsync({ id, reply });
      setReplyDrafts((current) => {
        const remaining = { ...current };
        delete remaining[id];
        return remaining;
      });
      setMessage("Consultation answered.");
      setError(undefined);
    } catch (reason) {
      // Another pharmacist answered first; the refetch drops the request from the open queue.
      if (reason instanceof ApiProblemError && reason.problem.code === "consultation_already_answered") {
        setError("Another pharmacist already answered this request.");
        await consultationsQuery.refetch();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Unable to answer the consultation request");
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
      {canOperateCounter ? null : (
        <Alert>
          {translateText("View only: dispensing, payments and consultation replies need the Pharmacist role.")}
        </Alert>
      )}
      {visibleError ? <p className="notice">{translateText(visibleError)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs
        tabs={
          canOperateCounter
            ? ["Prescriptions", "Create", "Dispense", "Counter transactions", "Consultations"]
            : ["Prescriptions", "Counter transactions", "Consultations"]
        }
        active={tab}
        onChange={setTab}
      />
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
            ...(canOperateCounter
              ? [
                  {
                    key: "actions",
                    label: "Actions",
                    render: (row: JsonRecord) => (
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
                ]
              : []),
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
            {() => (
              <div className="grid gap-2 sm:col-span-2">
                {selectedCustomer ? (
                  <UiField label={translateText("Customer account")}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-ink">{customerLabel(selectedCustomer)}</span>
                      <Button variant="ghost" size="sm" type="button" onClick={clearCustomer}>
                        {translateText("Clear")}
                      </Button>
                    </div>
                  </UiField>
                ) : (
                  <UiField
                    label={translateText("Customer account")}
                    hint={translateText("Search the exact phone number or email of the customer account.")}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="flex-1"
                        value={customerQuery}
                        placeholder={translateText("Phone or email")}
                        onChange={(event) => setCustomerQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          // The lookup runs on Enter as well as the button, and never submits the whole form.
                          event.preventDefault();
                          findCustomer();
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={customerLookup.isPending}
                        onClick={findCustomer}
                      >
                        {translateText("Find customer")}
                      </Button>
                    </div>
                  </UiField>
                )}
                {customerLookupNote ? <p className="text-xs text-muted">{translateText(customerLookupNote)}</p> : null}
                {customerMatches.length > 0 ? (
                  <ul className="grid gap-1">
                    {customerMatches.map((customer) => (
                      <li key={text(customer.id)}>
                        <Button variant="ghost" size="sm" type="button" onClick={() => selectCustomer(customer)}>
                          {customerLabel(customer)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
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
            ...(canOperateCounter
              ? [
                  {
                    key: "actions",
                    label: "Actions",
                    render: (row: JsonRecord) => (
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
                ]
              : []),
          ]}
        />
      ) : null}
      {tab === "Consultations" ? (
        <>
          <h2 className="section-title">{translateText("Prescription consultation requests")}</h2>
          <p className="page-subtitle">
            {translateText("Prescriptions shoppers asked a pharmacist to fill from the intake page.")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {consultationStatuses.map((status) => (
              <button
                key={status}
                type="button"
                className={status === consultationStatus ? "primary-button small" : "ghost-button small"}
                onClick={() => setConsultationStatus(status)}
              >
                {translateText(consultationStatusLabels[status])}
              </button>
            ))}
          </div>
          {consultationsError ? <p className="notice">{translateText(consultationsError)}</p> : null}
          {consultationsQuery.isPending && !consultationsQuery.data ? (
            <p className="loading-note">{translateText("Loading consultation requests...")}</p>
          ) : null}
          {!consultationsQuery.isPending && consultations.length === 0 ? (
            <EmptyState>No consultation requests.</EmptyState>
          ) : null}
          <div className="grid gap-3">
            {consultations.map((consultation) => {
              const fields = [
                { label: "Prescription code", value: consultation.prescription.code },
                { label: "Patient", value: consultation.prescription.patientName },
                { label: "Doctor", value: consultation.prescription.doctorName },
                { label: "Issuing facility", value: consultation.prescription.facilityName },
                { label: "Diagnosis", value: consultation.prescription.diagnosis },
                { label: "Issued on", value: consultation.prescription.issuedOn },
              ].filter((field) => field.value !== null);
              // Lines no catalog product could fill lead the card, so the pharmacist reads the gaps first.
              const lines = [...consultation.lines].sort(
                (left, right) => Number(right.needsHelp) - Number(left.needsHelp),
              );
              const replyDraft = replyDrafts[consultation.id] ?? "";
              return (
                <Card key={consultation.id}>
                  <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>
                        {consultation.siteId
                          ? referenceLabel(references.sites, consultation.siteId, ["code", "name"])
                          : translateText("No store selected")}
                      </CardTitle>
                      <CardDescription>
                        {translateText("Sent at")} {formatDateTime(consultation.createdAt)}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="status-chip">
                        {translateText(consultationStatusLabels[consultation.status])}
                      </span>
                      <Badge variant="secondary">
                        {translateText(consultation.source === "qr" ? "QR code" : "Photo")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {fields.length ? (
                      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {fields.map((field) => (
                          <div key={field.label}>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                              {translateText(field.label)}
                            </dt>
                            <dd className="mt-0.5 text-sm text-ink">{field.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {consultation.note ? (
                      <div className="rounded-md border border-line bg-surface-soft p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                          {translateText("Shopper note")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{consultation.note}</p>
                      </div>
                    ) : null}
                    <div className="grid gap-2">
                      {lines.map((line, index) => {
                        const details = [
                          line.activeIngredients.length
                            ? `${translateText("Active ingredients")}: ${line.activeIngredients.join(", ")}`
                            : undefined,
                          line.strength ? `${translateText("Strength")}: ${line.strength}` : undefined,
                          line.dosageForm ? `${translateText("Dosage form")}: ${line.dosageForm}` : undefined,
                          line.quantity !== null || line.unit
                            ? `${translateText("Quantity")}: ${
                                line.quantity === null ? "" : formatQuantity(line.quantity)
                              }${line.unit ? ` ${line.unit}` : ""}`
                            : undefined,
                          line.usage ? `${translateText("Usage")}: ${line.usage}` : undefined,
                          line.name && line.rawText !== line.name
                            ? `${translateText("As printed")}: ${line.rawText}`
                            : undefined,
                        ].filter((detail): detail is string => Boolean(detail));
                        return (
                          <div className="rounded-md border border-line p-3" key={index}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <strong className="text-sm text-ink">{line.name ?? line.rawText}</strong>
                              {line.needsHelp ? (
                                <Badge variant="danger">{translateText("Needs a substitute")}</Badge>
                              ) : null}
                            </div>
                            {details.length ? <p className="mt-1 text-xs text-muted">{details.join(" · ")}</p> : null}
                          </div>
                        );
                      })}
                    </div>
                    {consultation.status === "Open" && !canOperateCounter ? (
                      <p className="text-sm text-muted">{translateText("Waiting for a pharmacist to reply.")}</p>
                    ) : consultation.status === "Open" ? (
                      <div className="grid gap-2">
                        <label
                          className="text-xs font-semibold uppercase tracking-wide text-muted"
                          htmlFor={`consultation-reply-${consultation.id}`}
                        >
                          {translateText("Your reply")}
                        </label>
                        <Textarea
                          id={`consultation-reply-${consultation.id}`}
                          rows={3}
                          maxLength={2000}
                          placeholder={translateText("Tell the shopper which medicines to take instead")}
                          value={replyDraft}
                          onChange={(event) =>
                            setReplyDrafts((current) => ({ ...current, [consultation.id]: event.target.value }))
                          }
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-muted">{replyDraft.length}/2000</span>
                          <Button
                            size="sm"
                            disabled={!replyDraft.trim() || answerConsultation.isPending}
                            onClick={() => void sendConsultationReply(consultation.id)}
                          >
                            {translateText("Send reply")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-line bg-surface-soft p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                          {translateText("Pharmacist reply")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{consultation.reply}</p>
                        <p className="mt-1 text-xs text-muted">
                          {translateText("Answered at")} {formatDateTime(consultation.answeredAt)}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
};
