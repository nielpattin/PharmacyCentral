import { Alert, Button, useToast } from "@pharmacy/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Field, SelectField } from "../../components/forms.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { productLabel, useProductLookup } from "../../hooks/useProductLookup.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { ApiProblemError, formatQuantity, readOne, request, text, type JsonRecord } from "../../staff-api.ts";
import {
  canDispense,
  dispenseBody,
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
 * Dispenses the prescription chosen in the queue. The prescription id comes from the URL, so a refresh keeps the form.
 */
export const DispenseTab = ({
  prescriptionId,
  onBackToQueue,
}: {
  prescriptionId: string;
  onBackToQueue: () => void;
}): React.JSX.Element => {
  const detail = useQuery({
    queryKey: ["staff-prescription", prescriptionId],
    queryFn: () => readOne(`/api/prescriptions/${encodeURIComponent(prescriptionId)}`),
    enabled: prescriptionId !== "",
  });

  if (prescriptionId === "") {
    return (
      <div className="grid gap-3 rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
        <p>{translateText("Choose a prescription in the queue to dispense it.")}</p>
        <div>
          <Button variant="outline" size="sm" onClick={onBackToQueue}>
            {translateText("Open the queue")}
          </Button>
        </div>
      </div>
    );
  }
  if (detail.error) return <Alert variant="danger">{translateText(detail.error.message)}</Alert>;
  if (!detail.data) return <p className="text-sm text-muted">{translateText("Loading…")}</p>;
  // Keyed by prescription: each prescription opens with its own form state and its own idempotency key.
  return <DispenseForm key={prescriptionId} prescription={detail.data} onDone={onBackToQueue} />;
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
  const [formError, setFormError] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const formRef = useRef<HTMLFormElement>(null);
  const products = useProductLookup(lines.map((line) => line.productId));
  // Dirty once a batch is picked or a quantity is changed from the amount the form opened with.
  const initialLines = openDispenseLines(recordList(prescription.lines));
  const dirty = linesChanged(lines, initialLines);
  useUnsavedChangesGuard(dirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

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
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="grid gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        <DetailField label="Patient" value={text(prescription.patientName)} />
        <DetailField label="Prescription" value={text(prescription.prescriptionNumber, shortId(prescriptionId))} />
        <DetailField label="Status" value={translateText(status === "" ? "-" : status)} />
      </dl>
      {dispensable ? null : (
        <Alert variant="info">{translateText("This prescription cannot be dispensed in its current state.")}</Alert>
      )}
      {lines.length === 0 && dispensable ? (
        <Alert variant="info">{translateText("Every line of this prescription is already dispensed.")}</Alert>
      ) : null}
      {formError ? <Alert variant="danger">{translateText(formError)}</Alert> : null}
      {lines.map((line, index) => {
        const productBatches = references.batches.filter((batch) => text(batch.productId, "") === line.productId);
        return (
          <div key={line.prescriptionLineId} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
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
          </div>
        );
      })}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" type="button" onClick={onDone}>
          {translateText("Back to queue")}
        </Button>
        <Button type="submit" disabled={!dispensable || lines.length === 0}>
          {translateText("Dispense")}
        </Button>
      </div>
    </form>
  );
};
