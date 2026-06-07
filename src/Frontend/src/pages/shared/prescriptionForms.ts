import type { PrescriptionCreateRequest, PrescriptionDispenseLineRequest } from "../../api/pharmacyClient";

export type PrescriptionLineFormValues = Omit<PrescriptionCreateRequest["lines"][number], "prescribedQuantity"> & {
   prescribedQuantity: string;
};
export type PrescriptionFormValues = Omit<PrescriptionCreateRequest, "lines"> & { lines: PrescriptionLineFormValues[] };
export type DispenseLineFormValues = Omit<PrescriptionDispenseLineRequest, "dispensedQuantity"> & {
   dispensedQuantity: string;
};
export type DispenseFormValues = { lines: DispenseLineFormValues[] };

export function blankPrescriptionLineValues(): PrescriptionLineFormValues {
   return { productId: "", prescribedQuantity: "", dosage: "", frequency: "", duration: "", notes: "" };
}

export function blankPrescriptionValues(
   defaultPatientName = "",
   defaults?: { siteId?: string; storageLocationId?: string },
): PrescriptionFormValues {
   return {
      siteId: defaults?.siteId ?? "",
      storageLocationId: defaults?.storageLocationId ?? "",
      patientName: defaultPatientName,
      patientPhone: "",
      doctorName: "",
      doctorLicense: "",
      notes: "",
      lines: [blankPrescriptionLineValues()],
   };
}

export function arePrescriptionFormValuesEqual(left: PrescriptionFormValues, right: PrescriptionFormValues) {
   return (
      left.siteId === right.siteId &&
      left.storageLocationId === right.storageLocationId &&
      left.patientName === right.patientName &&
      left.patientPhone === right.patientPhone &&
      left.doctorName === right.doctorName &&
      left.doctorLicense === right.doctorLicense &&
      left.notes === right.notes &&
      left.lines.length === right.lines.length &&
      left.lines.every((line, index) => arePrescriptionLineFormValuesEqual(line, right.lines[index]))
   );
}

function arePrescriptionLineFormValuesEqual(
   left: PrescriptionLineFormValues,
   right: PrescriptionLineFormValues | undefined,
) {
   return (
      right !== undefined &&
      left.productId === right.productId &&
      left.prescribedQuantity === right.prescribedQuantity &&
      left.dosage === right.dosage &&
      left.frequency === right.frequency &&
      left.duration === right.duration &&
      left.notes === right.notes
   );
}

export function areDispenseFormValuesEqual(left: DispenseFormValues, right: DispenseFormValues) {
   return (
      left.lines.length === right.lines.length &&
      left.lines.every((line, index) => areDispenseLineFormValuesEqual(line, right.lines[index]))
   );
}

function areDispenseLineFormValuesEqual(left: DispenseLineFormValues, right: DispenseLineFormValues | undefined) {
   return (
      right !== undefined &&
      left.prescriptionLineId === right.prescriptionLineId &&
      left.productBatchId === right.productBatchId &&
      left.dispensedQuantity === right.dispensedQuantity
   );
}
