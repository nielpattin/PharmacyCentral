import type { GoodsReceiptUpsertRequest } from "../../api/pharmacyClient";

export type GoodsReceiptLineFormValues = {
   productId: string;
   batchNumber: string;
   expiryDate: string;
   manufacturedDate: string;
   manufacturer: string;
   quantity: string;
   notes: string;
};

export type GoodsReceiptFormValues = Omit<GoodsReceiptUpsertRequest, "notes" | "lines"> & {
   notes: string;
   lines: GoodsReceiptLineFormValues[];
};

export function blankGoodsReceiptLineValues(): GoodsReceiptLineFormValues {
   return {
      productId: "",
      batchNumber: "",
      expiryDate: "",
      manufacturedDate: "",
      manufacturer: "",
      quantity: "",
      notes: "",
   };
}

export function blankGoodsReceiptValues(): GoodsReceiptFormValues {
   return {
      supplierId: "",
      siteId: "",
      storageLocationId: "",
      receiptNumber: "",
      notes: "",
      lines: [blankGoodsReceiptLineValues()],
   };
}

export function areGoodsReceiptFormValuesEqual(left: GoodsReceiptFormValues, right: GoodsReceiptFormValues) {
   return (
      left.supplierId === right.supplierId &&
      left.siteId === right.siteId &&
      left.storageLocationId === right.storageLocationId &&
      left.receiptNumber === right.receiptNumber &&
      left.notes === right.notes &&
      left.lines.length === right.lines.length &&
      left.lines.every((line, index) => areGoodsReceiptLineFormValuesEqual(line, right.lines[index]))
   );
}

function areGoodsReceiptLineFormValuesEqual(left: GoodsReceiptLineFormValues, right: GoodsReceiptLineFormValues | undefined) {
   return (
      right !== undefined &&
      left.productId === right.productId &&
      left.batchNumber === right.batchNumber &&
      left.expiryDate === right.expiryDate &&
      left.manufacturedDate === right.manufacturedDate &&
      left.manufacturer === right.manufacturer &&
      left.quantity === right.quantity &&
      left.notes === right.notes
   );
}
