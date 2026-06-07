import type {
   CountSheetLineUpsertRequest,
   StockAdjustmentCreateRequest,
   StocktakeSessionCreateRequest,
} from "../../api/pharmacyClient";

export type StocktakeSessionFormValues = StocktakeSessionCreateRequest & { notes: string };
export type CountSheetLineFormValues = Omit<CountSheetLineUpsertRequest, "countedQuantity" | "notes"> & {
   countedQuantity: string;
   notes: string;
};
export type CountSheetFormValues = { countSheetLines: CountSheetLineFormValues[] };
export type StockAdjustmentFormValues = Omit<StockAdjustmentCreateRequest, "quantity" | "notes"> & {
   quantity: string;
   notes: string;
};

export function blankStocktakeSessionValues(): StocktakeSessionFormValues {
   return { siteId: "", storageLocationId: "", notes: "" };
}

export function blankCountSheetValues(): CountSheetFormValues {
   return { countSheetLines: [] };
}

export function blankStockAdjustmentValues(siteId = "", storageLocationId = ""): StockAdjustmentFormValues {
   return {
      productId: "",
      productBatchId: "",
      siteId,
      storageLocationId,
      adjustmentType: "Positive",
      quantity: "",
      reason: "",
      notes: "",
   };
}

export function areStocktakeSessionFormValuesEqual(
   left: StocktakeSessionFormValues,
   right: StocktakeSessionFormValues,
) {
   return (
      left.siteId === right.siteId && left.storageLocationId === right.storageLocationId && left.notes === right.notes
   );
}

export function areCountSheetFormValuesEqual(left: CountSheetFormValues, right: CountSheetFormValues) {
   return (
      left.countSheetLines.length === right.countSheetLines.length &&
      left.countSheetLines.every((line, index) => areCountSheetLineFormValuesEqual(line, right.countSheetLines[index]))
   );
}

function areCountSheetLineFormValuesEqual(left: CountSheetLineFormValues, right: CountSheetLineFormValues | undefined) {
   return (
      right !== undefined &&
      left.productId === right.productId &&
      left.productBatchId === right.productBatchId &&
      left.countedQuantity === right.countedQuantity &&
      left.notes === right.notes
   );
}

export function areStockAdjustmentFormValuesEqual(left: StockAdjustmentFormValues, right: StockAdjustmentFormValues) {
   return (
      left.productId === right.productId &&
      left.productBatchId === right.productBatchId &&
      left.siteId === right.siteId &&
      left.storageLocationId === right.storageLocationId &&
      left.adjustmentType === right.adjustmentType &&
      left.quantity === right.quantity &&
      left.reason === right.reason &&
      left.notes === right.notes
   );
}
