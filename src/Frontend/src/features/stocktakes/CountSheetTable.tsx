import { useState } from "react";
import { Button } from "../../components/shadcn/button";
import type { CountSheetLineDetails, ProductDto, StocktakeSessionDetails } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { areCountSheetFormValuesEqual, type CountSheetFormValues } from "../../pages/shared/stocktakeForms";

type CountSheetTableProps = {
   session: StocktakeSessionDetails;
   products: ProductDto[];
   isSaving: boolean;
   onSubmit: (values: CountSheetFormValues) => Promise<void>;
};

export function CountSheetTable({ session, products, isSaving, onSubmit }: CountSheetTableProps) {
   const t = useT();
   const initialValues: CountSheetFormValues = {
      countSheetLines: session.countSheetLines.map((line) => ({
         productId: line.productId,
         productBatchId: line.productBatchId,
         countedQuantity: String(line.countedQuantity),
         notes: line.notes ?? "",
      })),
   };
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isDirty = !areCountSheetFormValuesEqual(values, baselineValues);
   const productName = (productId: string) => products.find((product) => product.id === productId)?.name ?? "—";
   const sourceLine = (line: CountSheetLineDetails) =>
      values.countSheetLines.find(
         (item) => item.productId === line.productId && item.productBatchId === line.productBatchId,
      );

   function validate() {
      if (values.countSheetLines.length === 0) return t("stocktake.validationCountLinesRequired");
      const invalidLine = values.countSheetLines.findIndex(
         (line) =>
            line.productId === "" ||
            line.productBatchId === "" ||
            Number(line.countedQuantity) < 0 ||
            Number.isNaN(Number(line.countedQuantity)),
      );
      return invalidLine >= 0 ? t("stocktake.validationCountLine", { line: invalidLine + 1 }) : null;
   }

   return (
      <form
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
         <div className="table-wrap">
            <table className="selectable-table sites-table">
               <thead>
                  <tr>
                     <th>{t("stocktake.product")}</th>
                     <th>{t("stocktake.expected")}</th>
                     <th>{t("stocktake.counted")}</th>
                     <th>{t("stocktake.variance")}</th>
                     <th>{t("forms.notes")}</th>
                  </tr>
               </thead>
               <tbody>
                  {session.countSheetLines.map((line) => {
                     const value = sourceLine(line);
                     const counted = Number(value?.countedQuantity ?? 0);
                     return (
                        <tr key={line.id}>
                           <td>{productName(line.productId)}</td>
                           <td>{line.expectedQuantity}</td>
                           <td>
                              <input
                                 className="field-input"
                                 type="number"
                                 min="0"
                                 step="0.01"
                                 value={value?.countedQuantity ?? ""}
                                 onChange={(event) =>
                                    setValues((current) => ({
                                       countSheetLines: current.countSheetLines.map((item) =>
                                          item.productId === line.productId &&
                                          item.productBatchId === line.productBatchId
                                             ? { ...item, countedQuantity: event.target.value }
                                             : item,
                                       ),
                                    }))
                                 }
                              />
                           </td>
                           <td>{counted - line.expectedQuantity}</td>
                           <td>
                              <input
                                 className="field-input"
                                 value={value?.notes ?? ""}
                                 onChange={(event) =>
                                    setValues((current) => ({
                                       countSheetLines: current.countSheetLines.map((item) =>
                                          item.productId === line.productId &&
                                          item.productBatchId === line.productBatchId
                                             ? { ...item, notes: event.target.value }
                                             : item,
                                       ),
                                    }))
                                 }
                              />
                           </td>
                        </tr>
                     );
                  })}
               </tbody>
            </table>
         </div>
         <div className="form-actions">
            <Button type="submit" disabled={isSaving || !isDirty}>
               {t("stocktake.count")}
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
