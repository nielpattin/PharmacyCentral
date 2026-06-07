import { useMemo, useState } from "react";
import { Button } from "../../components/shadcn/button";
import { Field } from "../../components/ui/Field";
import type { ProductDto, PurchaseOrderDto, SiteDto, StorageLocationDto, SupplierDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import {
   areGoodsReceiptFormValuesEqual,
   blankGoodsReceiptLineValues,
   type GoodsReceiptFormValues,
} from "../../pages/shared/goodsReceiptForms";

type GoodsReceiptFormProps = {
   initialValues: GoodsReceiptFormValues;
   isSaving: boolean;
   products: ProductDto[];
   suppliers: SupplierDto[];
   purchaseOrders: PurchaseOrderDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onSubmit: (values: GoodsReceiptFormValues) => Promise<void>;
};

export function GoodsReceiptForm({
   initialValues,
   isSaving,
   products,
   purchaseOrders,
   suppliers,
   sites,
   storageLocations,
   onSubmit,
}: GoodsReceiptFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isDirty = !areGoodsReceiptFormValuesEqual(values, baselineValues);

   const availableStorageLocations = useMemo(() => {
      if (values.siteId === "") {
         return storageLocations;
      }

      return storageLocations.filter((location) => location.siteId === values.siteId);
   }, [storageLocations, values.siteId]);

   const availablePurchaseOrders = useMemo(() => {
      return purchaseOrders.filter(
         (order) =>
            (order.status === "Approved" || order.status === "PartiallyReceived") &&
            (values.siteId === "" || order.siteId === values.siteId) &&
            (values.supplierId === "" || order.supplierId === values.supplierId),
      );
   }, [purchaseOrders, values.siteId, values.supplierId]);

   function validate() {
      if (
         values.supplierId === "" ||
         values.siteId === "" ||
         values.storageLocationId === "" ||
         values.receiptNumber.trim() === ""
      ) {
         return t("receiving.validationHeader");
      }

      if (values.lines.length === 0) {
         return t("receiving.validationLinesRequired");
      }

      const invalidLine = values.lines.findIndex(
         (line) =>
            line.productId === "" ||
            line.batchNumber.trim() === "" ||
            line.expiryDate === "" ||
            Number(line.quantity) <= 0,
      );
      if (invalidLine >= 0) {
         return t("receiving.validationLine", { line: invalidLine + 1 });
      }

      return null;
   }

   return (
      <form
         className="grid gap-3"
         onSubmit={async (event) => {
            event.preventDefault();
            if (isSaving || !isDirty) {
               return;
            }

            const error = validate();
            setValidationError(error);
            if (error !== null) {
               return;
            }

            await onSubmit(values);
            setBaselineValues(values);
         }}
      >
         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}
         <div className="form-grid">
            <Field label={t("receiving.supplier")} required>
               <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.supplierId}
                  onChange={(event) => setValues((current) => ({ ...current, supplierId: event.target.value }))}
               >
                  <option value="">{t("receiving.selectSupplier")}</option>
                  {suppliers.map((supplier) => (
                     <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                     </option>
                  ))}
               </select>
            </Field>
            <Field label={t("receiving.site")} required>
               <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.siteId}
                  onChange={(event) =>
                     setValues((current) => ({ ...current, siteId: event.target.value, storageLocationId: "" }))
                  }
               >
                  <option value="">{t("forms.selectSite")}</option>
                  {sites.map((site) => (
                     <option key={site.id} value={site.id}>
                        {site.name}
                     </option>
                  ))}
               </select>
            </Field>
            <Field label={t("receiving.location")} required>
               <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.storageLocationId}
                  onChange={(event) => setValues((current) => ({ ...current, storageLocationId: event.target.value }))}
               >
                  <option value="">{t("receiving.selectLocation")}</option>
                  {availableStorageLocations.map((location) => (
                     <option key={location.id} value={location.id}>
                        {location.name}
                     </option>
                  ))}
               </select>
            </Field>
            <Field label={t("procurement.purchaseOrder")}>
               <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={values.purchaseOrderId ?? ""}
                  onChange={(event) =>
                     setValues((current) => ({
                        ...current,
                        purchaseOrderId: event.target.value === "" ? null : event.target.value,
                     }))
                  }
               >
                  <option value="">{t("receiving.directReceipt")}</option>
                  {availablePurchaseOrders.map((order) => (
                     <option key={order.id} value={order.id}>
                        {order.purchaseOrderNumber}
                     </option>
                  ))}
               </select>
            </Field>
            <Field label={t("receiving.receiptNumber")} required>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.receiptNumber}
                  onChange={(event) => setValues((current) => ({ ...current, receiptNumber: event.target.value }))}
               />
            </Field>
            <Field label={t("forms.notes")} className="col-span-full">
               <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  rows={3}
                  value={values.notes}
                  onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
               />
            </Field>
         </div>

         <div className="flex items-start justify-between gap-3">
            <div>
               <h3 className="m-0 text-sm font-semibold text-foreground">{t("receiving.lines")}</h3>
               <p className="mt-1 text-sm text-muted-foreground">{t("receiving.linesDesc")}</p>
            </div>
            <Button
               variant="outline"
               size="sm"
               onClick={() =>
                  setValues((current) => ({ ...current, lines: [...current.lines, blankGoodsReceiptLineValues()] }))
               }
            >
               {t("receiving.addLine")}
            </Button>
         </div>

         {values.lines.map((line, index) => (
            <div className="form-grid" key={index}>
               <Field label={t("receiving.product")} required>
                  <select
                     className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                     required
                     value={line.productId}
                     onChange={(event) =>
                        setValues((current) => ({
                           ...current,
                           lines: current.lines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, productId: event.target.value } : item,
                           ),
                        }))
                     }
                  >
                     <option value="">{t("receiving.selectProduct")}</option>
                     {products.map((product) => (
                        <option key={product.id} value={product.id}>
                           {product.sku} · {product.name}
                        </option>
                     ))}
                  </select>
               </Field>
               <Field label={t("receiving.batchNumber")} required>
                  <input
                     className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                     required
                     value={line.batchNumber}
                     onChange={(event) =>
                        setValues((current) => ({
                           ...current,
                           lines: current.lines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, batchNumber: event.target.value } : item,
                           ),
                        }))
                     }
                  />
               </Field>
               <Field label={t("receiving.expiryDate")} required>
                  <input
                     className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                     required
                     type="date"
                     value={line.expiryDate}
                     onChange={(event) =>
                        setValues((current) => ({
                           ...current,
                           lines: current.lines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, expiryDate: event.target.value } : item,
                           ),
                        }))
                     }
                  />
               </Field>
               <Field label={t("receiving.quantity")} required>
                  <input
                     className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                     required
                     min="0.01"
                     step="0.01"
                     type="number"
                     value={line.quantity}
                     onChange={(event) =>
                        setValues((current) => ({
                           ...current,
                           lines: current.lines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, quantity: event.target.value } : item,
                           ),
                        }))
                     }
                  />
               </Field>
               <Field label={t("receiving.manufacturedDate")}>
                  <input
                     className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                     type="date"
                     value={line.manufacturedDate}
                     onChange={(event) =>
                        setValues((current) => ({
                           ...current,
                           lines: current.lines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, manufacturedDate: event.target.value } : item,
                           ),
                        }))
                     }
                  />
               </Field>
               <Field label={t("forms.manufacturer")}>
                  <input
                     className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                     value={line.manufacturer}
                     onChange={(event) =>
                        setValues((current) => ({
                           ...current,
                           lines: current.lines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, manufacturer: event.target.value } : item,
                           ),
                        }))
                     }
                  />
               </Field>
               <Field label={t("forms.notes")} className="col-span-full">
                  <textarea
                     className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                     rows={2}
                     value={line.notes}
                     onChange={(event) =>
                        setValues((current) => ({
                           ...current,
                           lines: current.lines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, notes: event.target.value } : item,
                           ),
                        }))
                     }
                  />
               </Field>
               <div className="flex flex-wrap justify-end gap-2">
                  <Button
                     variant="destructive"
                     size="sm"
                     onClick={() =>
                        setValues((current) => ({
                           ...current,
                           lines: current.lines.filter((_, itemIndex) => itemIndex !== index),
                        }))
                     }
                     disabled={isSaving || values.lines.length <= 1}
                  >
                     {t("receiving.removeLine")}
                  </Button>
               </div>
            </div>
         ))}

         <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" disabled={isSaving || !isDirty}>
               {isSaving ? t("receiving.saving") : t("receiving.createButton")}
            </Button>
            <Button
               variant="outline"
               type="button"
               onClick={() => {
                  setValues(baselineValues);
                  setValidationError(null);
               }}
               disabled={isSaving || !isDirty}
            >
               {t("common.reset")}
            </Button>
         </div>
      </form>
   );
}
