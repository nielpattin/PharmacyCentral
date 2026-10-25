import { useForm, useStore } from "@tanstack/react-form";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@pharmacy/ui";
import { useState } from "react";
import { z } from "zod";

import { Field, SelectField } from "../../components/forms.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { AddLineButton, LineCard } from "../../components/form-parts.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { ApiProblemError, readRows, request, text, type JsonRecord } from "../../staff-api.ts";
import {
  createPrescriptionBody,
  emptyPrescriptionHeader,
  emptyPrescriptionLine,
  linesChanged,
  newIdempotencyKey,
  type PrescriptionHeader,
  type PrescriptionLineDraft,
} from "../sales/rules.ts";
import { CustomerPicker } from "./customer-picker.tsx";

// Patient details are kept on this device until the prescription is created. The customer link is left out: a restored
// account id with no account name beside it would be invisible on screen. Lines are not drafted either; the draft
// stores text fields only.
const prescriptionDraftSchema = z.object({
  siteId: z.string(),
  storageLocationId: z.string(),
  patientName: z.string(),
  patientPhone: z.string(),
  doctorName: z.string(),
  doctorLicense: z.string(),
  notes: z.string(),
});

/**
 * Creates a prescription in a side drawer and asks inventory to reserve its stock. The request carries an
 * Idempotency-Key that is made once per mount, so a retried submit cannot create a second prescription. Mount it only
 * while it should be open.
 */
export const CreatePrescriptionDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const references = useStaffReferences();
  const [lines, setLines] = useState<PrescriptionLineDraft[]>(() => [emptyPrescriptionLine()]);
  const [customer, setCustomer] = useState<JsonRecord>();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  // Units come from the product's own units endpoint, which is how the catalog reads them too.
  const unitQueries = useQueries({
    queries: [...new Set(lines.map((line) => line.productId).filter((id) => id !== ""))].map((productId) => ({
      queryKey: ["staff-product-units", productId],
      queryFn: () => readRows(`/api/products/${encodeURIComponent(productId)}/units`),
    })),
  });
  const unitsByProduct = new Map<string, JsonRecord[]>();
  [...new Set(lines.map((line) => line.productId).filter((id) => id !== ""))].forEach((productId, index) => {
    const data = unitQueries[index]?.data;
    if (data) unitsByProduct.set(productId, data);
  });

  const submit = async (header: PrescriptionHeader): Promise<void> => {
    try {
      await request("/api/prescriptions", {
        method: "POST",
        body: JSON.stringify(createPrescriptionBody(header, lines)),
        idempotencyKey,
      });
    } catch (reason) {
      // The server answered, so this key is spent and a retry must be a new request. A network failure keeps the key,
      // because the server may already have stored the prescription under it.
      if (reason instanceof ApiProblemError) setIdempotencyKey(newIdempotencyKey());
      toast.error(translateText(reason instanceof Error ? reason.message : "Unable to create prescription"));
      return;
    }
    toast.success(translateText("Prescription created and stock reservation requested."));
    draft.clear();
    await queryClient.invalidateQueries({ queryKey: ["staff-prescriptions"] });
    onClose();
  };

  const form = useForm({
    defaultValues: emptyPrescriptionHeader(),
    onSubmit: async ({ value }) => submit(value),
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const linesDirty = linesChanged(lines, [emptyPrescriptionLine()]);
  const draft = useDraft("prescription", form, { schema: prescriptionDraftSchema, exclude: ["customerId"] });

  const updateLine = (index: number, patch: Partial<PrescriptionLineDraft>): void =>
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));

  const selectCustomer = (picked: JsonRecord): void => {
    form.setFieldValue("customerId", text(picked.id, ""));
    // Picking the account fills the patient details it knows, but never overwrites what staff already typed.
    const name = text(picked.displayName, "");
    if (name && form.getFieldValue("patientName") === "") form.setFieldValue("patientName", name);
    const phone = text(picked.phoneNumber, "");
    if (phone && form.getFieldValue("patientPhone") === "") form.setFieldValue("patientPhone", phone);
    setCustomer(picked);
  };

  const clearCustomer = (): void => {
    form.setFieldValue("customerId", "");
    setCustomer(undefined);
  };

  return (
    <FormDrawer
      title="Create prescription"
      formId="prescription-create-form"
      submitLabel="Create and reserve"
      isDirty={isDirty || linesDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      {draft.banner ? <div className="sm:col-span-2">{draft.banner}</div> : null}
      <form.Field name="siteId">
        {(field) => (
          <SelectField
            label="Site"
            value={field.state.value}
            onChange={field.handleChange}
            options={referenceOptions(references.sites, ["code", "name"])}
            required
          />
        )}
      </form.Field>
      <form.Field name="storageLocationId">
        {(field) => (
          <SelectField
            label="Storage location"
            value={field.state.value}
            onChange={field.handleChange}
            options={referenceOptions(references.locations, ["code", "name"])}
            required
          />
        )}
      </form.Field>
      <form.Field name="patientName">
        {(field) => <Field label="Patient name" value={field.state.value} onChange={field.handleChange} required />}
      </form.Field>
      <form.Field name="patientPhone">
        {(field) => <Field label="Patient phone" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <div className="sm:col-span-2">
        <CustomerPicker selected={customer} onSelect={selectCustomer} onClear={clearCustomer} />
      </div>
      <form.Field name="doctorName">
        {(field) => <Field label="Doctor name" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="doctorLicense">
        {(field) => <Field label="Doctor license" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      {lines.map((line, index) => (
        <LineCard
          key={index}
          index={index}
          onRemove={
            lines.length > 1
              ? () => setLines((current) => current.filter((_line, lineIndex) => lineIndex !== index))
              : undefined
          }
        >
          <ProductPicker
            label={translateText("Product")}
            value={line.productId}
            onChange={(productId) => updateLine(index, { productId, productUnitId: "" })}
            required
          />
          <SelectField
            label="Product unit"
            value={line.productUnitId}
            onChange={(value) => updateLine(index, { productUnitId: value })}
            options={referenceOptions(unitsByProduct.get(line.productId) ?? [], ["unitName"])}
            required
          />
          <Field
            label="Quantity"
            type="number"
            value={line.prescribedQuantity}
            onChange={(value) => updateLine(index, { prescribedQuantity: value })}
            required
          />
          <Field label="Dosage" value={line.dosage} onChange={(value) => updateLine(index, { dosage: value })} />
          <Field
            label="Frequency"
            value={line.frequency}
            onChange={(value) => updateLine(index, { frequency: value })}
          />
          <Field label="Duration" value={line.duration} onChange={(value) => updateLine(index, { duration: value })} />
          <Field label="Line notes" value={line.notes} onChange={(value) => updateLine(index, { notes: value })} />
        </LineCard>
      ))}
      <AddLineButton onAdd={() => setLines((current) => [...current, emptyPrescriptionLine()])} />
      <form.Field name="notes">
        {(field) => (
          <div className="sm:col-span-2">
            <Field label="Notes" value={field.state.value} onChange={field.handleChange} />
          </div>
        )}
      </form.Field>
    </FormDrawer>
  );
};
