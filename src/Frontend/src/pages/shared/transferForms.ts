import type { TransferCreateRequest, TransferReceiveLineRequest, TransferShipLineRequest } from "../../api/pharmacyClient";

export type TransferLineFormValues = Omit<TransferCreateRequest["lines"][number], "requestedQuantity" | "notes"> & { requestedQuantity: string; notes: string };
export type TransferOrderFormValues = Omit<TransferCreateRequest, "notes" | "lines"> & { notes: string; lines: TransferLineFormValues[] };
export type TransferShipLineFormValues = Omit<TransferShipLineRequest, "shippedQuantity"> & { shippedQuantity: string };
export type TransferShipFormValues = { lines: TransferShipLineFormValues[] };
export type TransferReceiveLineFormValues = Omit<TransferReceiveLineRequest, "receivedQuantity"> & { receivedQuantity: string };
export type TransferReceiveFormValues = { lines: TransferReceiveLineFormValues[] };

export function blankTransferLineValues(): TransferLineFormValues {
   return { productId: "", productBatchId: "", requestedQuantity: "", notes: "" };
}

export function blankTransferOrderValues(): TransferOrderFormValues {
   return {
      sourceSiteId: "",
      sourceStorageLocationId: "",
      destinationSiteId: "",
      destinationStorageLocationId: "",
      notes: "",
      lines: [blankTransferLineValues()],
   };
}

export function blankTransferShipValues(): TransferShipFormValues {
   return { lines: [] };
}

export function blankTransferReceiveValues(): TransferReceiveFormValues {
   return { lines: [] };
}

export function areTransferOrderFormValuesEqual(left: TransferOrderFormValues, right: TransferOrderFormValues) {
   return (
      left.sourceSiteId === right.sourceSiteId &&
      left.sourceStorageLocationId === right.sourceStorageLocationId &&
      left.destinationSiteId === right.destinationSiteId &&
      left.destinationStorageLocationId === right.destinationStorageLocationId &&
      left.notes === right.notes &&
      left.lines.length === right.lines.length &&
      left.lines.every((line, index) => areTransferLineFormValuesEqual(line, right.lines[index]))
   );
}

function areTransferLineFormValuesEqual(left: TransferLineFormValues, right: TransferLineFormValues | undefined) {
   return right !== undefined && left.productId === right.productId && left.productBatchId === right.productBatchId && left.requestedQuantity === right.requestedQuantity && left.notes === right.notes;
}

export function areTransferShipFormValuesEqual(left: TransferShipFormValues, right: TransferShipFormValues) {
   return left.lines.length === right.lines.length && left.lines.every((line, index) => areTransferShipLineFormValuesEqual(line, right.lines[index]));
}

function areTransferShipLineFormValuesEqual(left: TransferShipLineFormValues, right: TransferShipLineFormValues | undefined) {
   return right !== undefined && left.transferOrderLineId === right.transferOrderLineId && left.shippedQuantity === right.shippedQuantity;
}

export function areTransferReceiveFormValuesEqual(left: TransferReceiveFormValues, right: TransferReceiveFormValues) {
   return left.lines.length === right.lines.length && left.lines.every((line, index) => areTransferReceiveLineFormValuesEqual(line, right.lines[index]));
}

function areTransferReceiveLineFormValuesEqual(left: TransferReceiveLineFormValues, right: TransferReceiveLineFormValues | undefined) {
   return right !== undefined && left.transferOrderLineId === right.transferOrderLineId && left.receivedQuantity === right.receivedQuantity;
}
