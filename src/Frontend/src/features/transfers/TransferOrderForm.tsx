import { useMemo, useState } from "react";
import { Button } from "../../components/shadcn/button";
import { Field } from "../../components/ui/Field";
import type { InventoryBalanceDto, ProductDto, SiteDto, StorageLocationDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import {
   areTransferOrderFormValuesEqual,
   blankTransferLineValues,
   type TransferLineFormValues,
   type TransferOrderFormValues,
} from "../../pages/shared/transferForms";

type TransferOrderFormProps = {
   initialValues: TransferOrderFormValues;
   isSaving: boolean;
   inventoryBalances: InventoryBalanceDto[];
   products: ProductDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onSubmit: (values: TransferOrderFormValues) => Promise<void>;
};

export function TransferOrderForm({
   initialValues,
   isSaving,
   inventoryBalances,
   products,
   sites,
   storageLocations,
   onSubmit,
}: TransferOrderFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isDirty = !areTransferOrderFormValuesEqual(values, baselineValues);

   const availableSourceStorageLocations = useMemo(
      () =>
         values.sourceSiteId === ""
            ? storageLocations
            : storageLocations.filter((location) => location.siteId === values.sourceSiteId),
      [storageLocations, values.sourceSiteId],
   );
   const availableDestinationStorageLocations = useMemo(
      () =>
         values.destinationSiteId === ""
            ? storageLocations
            : storageLocations.filter((location) => location.siteId === values.destinationSiteId),
      [storageLocations, values.destinationSiteId],
   );

   function batchOptions(line: TransferLineFormValues) {
      return inventoryBalances.filter((balance) => {
         if (line.productId === "" || balance.productId !== line.productId) return false;
         if (values.sourceSiteId !== "" && balance.siteId !== values.sourceSiteId) return false;
         if (values.sourceStorageLocationId !== "" && balance.storageLocationId !== values.sourceStorageLocationId)
            return false;
         return balance.quantityOnHand > 0;
      });
   }

   function validate() {
      if (
         values.sourceSiteId === "" ||
         values.sourceStorageLocationId === "" ||
         values.destinationSiteId === "" ||
         values.destinationStorageLocationId === ""
      ) {
         return t("transfer.validationHeader");
      }

      if (values.sourceSiteId === values.destinationSiteId) {
         return t("transfer.validationDifferentSites");
      }

      if (values.lines.length === 0) {
         return t("transfer.validationLinesRequired");
      }

      const invalidLine = values.lines.findIndex(
         (line) =>
            line.productId === "" ||
            line.productBatchId === "" ||
            Number(line.requestedQuantity) <= 0 ||
            Number.isNaN(Number(line.requestedQuantity)),
      );
      return invalidLine >= 0 ? t("transfer.validationLine", { line: invalidLine + 1 }) : null;
   }

   return (
      <form
         className="entity-form"
         onSubmit={async (event) => {
            event.preventDefault();
            if (isSaving || !isDirty) return;
            const error = validate();
            setValidationError(error);
            if (error !== null) return;
            await onSubmit(values);
            setBaselineValues(values);
         }}
      >
         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}
         <div className="form-grid">
            <Field label={t("transfer.source")} required>
               <select
                  className="field-input"
                  required
                  value={values.sourceSiteId}
                  onChange={(event) =>
                     setValues((current) => ({
                        ...current,
                        sourceSiteId: event.target.value,
                        sourceStorageLocationId: "",
                        lines: current.lines.map((line) => ({ ...line, productBatchId: "" })),
                     }))
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
            <Field label={t("transfer.sourceLocation")} required>
               <select
                  className="field-input"
                  required
                  value={values.sourceStorageLocationId}
                  onChange={(event) =>
                     setValues((current) => ({
                        ...current,
                        sourceStorageLocationId: event.target.value,
                        lines: current.lines.map((line) => ({ ...line, productBatchId: "" })),
                     }))
                  }
               >
                  <option value="">{t("transfer.selectLocation")}</option>
                  {availableSourceStorageLocations.map((location) => (
                     <option key={location.id} value={location.id}>
                        {location.name}
                     </option>
                  ))}
               </select>
            </Field>
            <Field label={t("transfer.destination")} required>
               <select
                  className="field-input"
                  required
                  value={values.destinationSiteId}
                  onChange={(event) =>
                     setValues((current) => ({
                        ...current,
                        destinationSiteId: event.target.value,
                        destinationStorageLocationId: "",
                     }))
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
            <Field label={t("transfer.destinationLocation")} required>
               <select
                  className="field-input"
                  required
                  value={values.destinationStorageLocationId}
                  onChange={(event) =>
                     setValues((current) => ({ ...current, destinationStorageLocationId: event.target.value }))
                  }
               >
                  <option value="">{t("transfer.selectLocation")}</option>
                  {availableDestinationStorageLocations.map((location) => (
                     <option key={location.id} value={location.id}>
                        {location.name}
                     </option>
                  ))}
               </select>
            </Field>
            <Field label={t("forms.notes")} className="field-wide">
               <textarea
                  className="field-input field-textarea"
                  rows={3}
                  value={values.notes}
                  onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
               />
            </Field>
         </div>

         <div className="section-header">
            <div>
               <h3 className="section-title">{t("transfer.lines")}</h3>
               <p className="section-subtitle">{t("transfer.linesDesc")}</p>
            </div>
            <Button
               variant="outline"
               size="sm"
               onClick={() =>
                  setValues((current) => ({ ...current, lines: [...current.lines, blankTransferLineValues()] }))
               }
            >
               {t("transfer.addLine")}
            </Button>
         </div>

         {values.lines.map((line, index) => {
            const batches = batchOptions(line);
            return (
               <div className="form-grid" key={index}>
                  <Field label={t("transfer.product")} required>
                     <select
                        className="field-input"
                        required
                        value={line.productId}
                        onChange={(event) =>
                           setValues((current) => ({
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                 itemIndex === index
                                    ? { ...item, productId: event.target.value, productBatchId: "" }
                                    : item,
                              ),
                           }))
                        }
                     >
                        <option value="">{t("transfer.selectProduct")}</option>
                        {products.map((product) => (
                           <option key={product.id} value={product.id}>
                              {product.sku} · {product.name}
                           </option>
                        ))}
                     </select>
                  </Field>
                  <Field label={t("transfer.batch")} required>
                     <select
                        className="field-input"
                        required
                        value={line.productBatchId}
                        disabled={line.productId === "" || batches.length === 0}
                        onChange={(event) =>
                           setValues((current) => ({
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                 itemIndex === index ? { ...item, productBatchId: event.target.value } : item,
                              ),
                           }))
                        }
                     >
                        <option value="">{t("transfer.selectBatch")}</option>
                        {batches.map((balance) => (
                           <option key={balance.id} value={balance.productBatchId}>
                              {balance.batchNumber} · {new Date(balance.expiryDate).toLocaleDateString()} ·{" "}
                              {t("transfer.availableQuantity", { quantity: balance.quantityOnHand })}
                           </option>
                        ))}
                     </select>
                  </Field>
                  <Field label={t("transfer.requested")} required>
                     <input
                        className="field-input"
                        required
                        min="0.01"
                        step="0.01"
                        type="number"
                        value={line.requestedQuantity}
                        onChange={(event) =>
                           setValues((current) => ({
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                 itemIndex === index ? { ...item, requestedQuantity: event.target.value } : item,
                              ),
                           }))
                        }
                     />
                  </Field>
                  <Field label={t("forms.notes")}>
                     <input
                        className="field-input"
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
                  <div className="form-actions">
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
                        {t("transfer.removeLine")}
                     </Button>
                  </div>
               </div>
            );
         })}

         <div className="form-actions">
            <Button type="submit" disabled={isSaving || !isDirty}>
               {isSaving ? t("common.saving") : t("transfer.createButton")}
            </Button>
            <Button
               variant="outline"
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
