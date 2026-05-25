import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import type { ProductDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { formatValue, statusTone } from "../../pages/shared/pharmacyForms";

type ProductTableProps = {
   rows: ProductDto[];
   selectedProductId: string;
   onSelectProduct: (productId: string) => void;
   onDeleteProduct: (productId: string) => void;
};

export function ProductTable({ rows, selectedProductId, onSelectProduct, onDeleteProduct }: ProductTableProps) {
   const t = useT();

   return (
      <div className="table-wrap">
         <table className="selectable-table sites-table">
            <thead>
               <tr>
                  <th>{t("products.sku")}</th>
                  <th>{t("products.name")}</th>
                  <th>{t("products.category")}</th>
                  <th>{t("products.unit")}</th>
                  <th>{t("products.status")}</th>
                  <th>{t("common.actions")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((product) => {
                  const isSelected = selectedProductId === product.id;
                  return (
                     <tr
                        key={product.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectProduct(product.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectProduct(product.id);
                           }
                        }}
                     >
                        <td>{product.sku}</td>
                        <td>{product.name}</td>
                        <td>{formatValue(product.category)}</td>
                        <td>{formatValue(product.unit)}</td>
                        <td>
                           <Badge tone={statusTone(product.status)}>
                              {product.status === "Active" ? t("status.active") : t("status.inactive")}
                           </Badge>
                        </td>
                        <td>
                           <div className="table-actions">
                              <Button
                                 size="sm"
                                 variant="danger"
                                 onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteProduct(product.id);
                                 }}
                              >
                                 {t("common.delete")}
                              </Button>
                           </div>
                        </td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
