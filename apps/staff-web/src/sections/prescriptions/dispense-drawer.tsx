import { Alert, Card, useToast } from "@pharmacy/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { Field, SelectField } from "../../components/forms.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { productLabel, useProductLookup } from "../../hooks/useProductLookup.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { ApiProblemError, formatQuantity, readOne, request, text, type JsonRecord } from "../../staff-api.ts";
import {
  canDispense,
  dispenseBody,
  dispensableBatches,
  isDispenseQuantityValid,
  linesChanged,
  newIdempotencyKey,
  openDispenseLines,
  recordList,
  shortId,
  type DispenseLineDraft,
} from "../sales/rules.ts";
import { DetailField } from "../sales/shared.tsx";

/**
 * Dispenses one prescription in a side drawer. The prescription id comes from the URL, so a refresh keeps the drawer.
 * Mount it only while a prescription is chosen.
 */
export const DispenseDrawer = ({
  prescriptionId,
  onClose,
}: {
  prescriptionId: string;
  onClose: () => void;
}): React.JSX.Element => {
  const detail = useQuery({
    queryKey: ["staff-prescription", prescriptionId],
    queryFn: () => readOne(`/api/prescriptions/${encodeURIComponent(prescriptionId)}`),
  });
  if (detail.data) {
    // Keyed by prescription: each prescription opens with its own form state and its own idempotency key.
    return <DispenseForm key={prescriptionId} prescription={detail.data} onDone={onClose} />;
  }
  return (
    <EntityDrawer
      open
      onClose={onClose}
      title={translateText("Dispense")}
      details={
        detail.error ? (
          <Alert variant="danger">{translateText(detail.error.message)}</Alert>
        ) : (
          <p className="text-sm text-muted">{translateText("Loading…")}</p>
        )
      }
    />
  );
};

const DispenseForm = ({
  prescription,
  onDone,
}: {
  prescription: JsonRecord;
  onDone: () => void;
}): React.JSX.Element => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const references = useStaffReferences();
  const prescriptionId = text(prescription.id, "");
  const status = text(prescription.status, "");
  const dispensable = canDispense(status);
  const [lines, setLines] = useState<DispenseLineDraft[]>(() => openDispenseLines(recordList(prescription.lines)));
  const today = new Date().toISOString().slice(0, 10);
  const [formError, setFormError] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const products = useProductLookup(lines.map((line) => line.productId));
  // Dirty once a batch is picked or a quantity is changed from the amount the form opened with.
  const initialLines = openDispenseLines(recordList(prescription.lines));
  const dirty = linesChanged(lines, initialLines);

  const updateLine = (index: number, patch: Partial<DispenseLineDraft>): void =>
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));

  const submit = async (): Promise<void> => {
    if (!dispensable || lines.length === 0) return;
    if (!lines.every(isDispenseQuantityValid)) {
      setFormError("Enter a quantity from 1 up to the amount still due.");
      return;
    }
    setFormError(undefined);
    try {
      await request(`/api/prescriptions/${encodeURIComponent(prescriptionId)}/dispense`, {
        method: "POST",
        body: JSON.stringify(dispenseBody(lines)),
        idempotencyKey,
      });
    } catch (reason) {
      // The server answered, so this key is spent and a retry must be a new request.
      if (reason instanceof ApiProblemError) setIdempotencyKey(newIdempotencyKey());
      toast.error(translateText(reason instanceof Error ? reason.message : "Unable to dispense prescription"));
      return;
    }
    toast.success(translateText("Prescription dispensed."));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["staff-prescriptions"] }),
      queryClient.invalidateQueries({ queryKey: ["staff-prescription", prescriptionId] }),
    ]);
    onDone();
  };

  return (
    <FormDrawer
      title="Dispense"
      subtitle={text(prescription.prescriptionNumber, shortId(prescriptionId))}
      formId="prescription-dispense-form"
      submitLabel="Dispense"
      isDirty={dirty}
      onSubmit={() => void submit()}
      onClose={onDone}
    >
      <dl className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
        <DetailField label="Patient" value={text(prescription.patientName)} />
        <DetailField label="Prescription" value={text(prescription.prescriptionNumber, shortId(prescriptionId))} />
        <DetailField label="Status" value={translateText(status === "" ? "-" : status)} />
      </dl>
      {dispensable ? null : (
        <div className="sm:col-span-2">
          <Alert variant="info">{translateText("This prescription cannot be dispensed in its current state.")}</Alert>
        </div>
      )}
      {lines.length === 0 && dispensable ? (
        <div className="sm:col-span-2">
          <Alert variant="info">{translateText("Every line of this prescription is already dispensed.")}</Alert>
        </div>
      ) : null}
      {formError ? (
        <div className="sm:col-span-2">
          <Alert variant="danger">{translateText(formError)}</Alert>
        </div>
      ) : null}
      {lines.map((line, index) => {
        const productBatches = dispensableBatches(references.batches, line.productId, today);
        return (
          <Card key={line.prescriptionLineId} className="grid gap-3 p-4 sm:col-span-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <strong className="text-sm text-ink">
                {productLabel(products.get(line.productId), shortId(line.productId))}
              </strong>{" "}
              <span className="text-xs text-muted">
                {translateText("Still due")}: {formatQuantity(line.remaining)}
              </span>
            </div>
            <SelectField
              label="Product batch"
              value={line.productBatchId}
              onChange={(value) => updateLine(index, { productBatchId: value })}
              options={referenceOptions(productBatches, ["batchNumber"])}
              required
            />
            <Field
              label="Dispensed quantity"
              type="number"
              value={line.dispensedQuantity}
              onChange={(value) => updateLine(index, { dispensedQuantity: value })}
              required
            />
          </Card>
        );
      })}
    </FormDrawer>
  );
};
