import { useConfirm } from "../../components/confirm.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";

/** Prescription actions shared by a queue row and its drawer. Each one asks first or reports through a toast. */
export const usePrescriptionActions = () => {
  const run = useStaffAction();
  const confirm = useConfirm();

  const cancel = async (prescriptionId: string): Promise<void> => {
    const accepted = await confirm({
      title: "Cancel this prescription?",
      description: "Reserved stock is released, and the prescription can no longer be dispensed.",
      confirmLabel: "Cancel prescription",
      tone: "danger",
    });
    if (!accepted) return;
    await run({
      path: `/api/prescriptions/${encodeURIComponent(prescriptionId)}/cancel`,
      invalidate: [["staff-prescriptions"]],
      success: "Prescription cancelled.",
    });
  };

  const createInvoice = (prescriptionId: string): Promise<boolean> =>
    run({
      path: `/api/payments/prescriptions/${encodeURIComponent(prescriptionId)}`,
      invalidate: [["staff-prescriptions"], ["staff-counter-invoices"]],
      success: "Counter invoice created.",
    });

  return { cancel, createInvoice };
};
