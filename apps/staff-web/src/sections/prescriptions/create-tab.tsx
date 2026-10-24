import { useForm, useStore } from "@tanstack/react-form";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Button, useToast } from "@pharmacy/ui";
import { useRef, useState } from "react";
import { z } from "zod";

import { Field, SelectField } from "../../components/forms.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
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
 * Creates a prescription and asks inventory to reserve its stock. The request carries an Idempotency-Key that is made
 * once per mount, so a retried submit cannot create a second prescription.
 */
export const CreatePrescriptionTab = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const references = useStaffReferences();
  const formRef = useRef<HTMLFormElement>(null);
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
    setIdempotencyKey(newIdempotencyKey());
    draft.clear();
    form.reset();
    setLines([emptyPrescriptionLine()]);
    setCustomer(undefined);
    await queryClient.invalidateQueries({ queryKey: ["staff-prescriptions"] });
  };

  const form = useForm({
    defaultValues: emptyPrescriptionHeader(),
    onSubmit: async ({ value }) => submit(value),
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const linesDirty = linesChanged(lines, [emptyPrescriptionLine()]);
  const draft = useDraft("prescription", form, { schema: prescriptionDraftSchema, exclude: ["customerId"] });
  useUnsavedChangesGuard(isDirty || linesDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

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
    <div className="grid gap-3">
      {draft.banner}
      {isDirty ? <p className="text-xs text-muted">{translateText("Draft saved on this device")}</p> : null}
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        className="grid gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
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
          <div className="grid gap-3 sm:col-span-2">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
                <div className="flex items-center justify-between sm:col-span-2">
                  <strong className="text-sm text-ink">
                    {translateText("Line")} {index + 1}
                  </strong>
                  {lines.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="text-danger"
                      onClick={() => setLines((current) => current.filter((_line, lineIndex) => lineIndex !== index))}
                    >
                      {translateText("Remove line")}
                    </Button>
                  ) : null}
                </div>
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
                <Field
                  label="Duration"
                  value={line.duration}
                  onChange={(value) => updateLine(index, { duration: value })}
                />
                <Field
                  label="Line notes"
                  value={line.notes}
                  onChange={(value) => updateLine(index, { notes: value })}
                />
              </div>
            ))}
            <div>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setLines((current) => [...current, emptyPrescriptionLine()])}
              >
                {translateText("Add line")}
              </Button>
            </div>
          </div>
          <form.Field name="notes">
            {(field) => (
              <div className="sm:col-span-2">
                <Field label="Notes" value={field.state.value} onChange={field.handleChange} />
              </div>
            )}
          </form.Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {translateText("Create and reserve")}
          </Button>
        </div>
      </form>
    </div>
  );
};
