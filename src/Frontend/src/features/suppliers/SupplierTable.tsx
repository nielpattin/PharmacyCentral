import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import type { SupplierDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { formatValue, statusTone } from "../../pages/shared/pharmacyForms";

type SupplierTableProps = {
   rows: SupplierDto[];
   selectedSupplierId: string;
   onSelectSupplier: (supplierId: string) => void;
   onDeleteSupplier: (supplierId: string) => void;
};

export function SupplierTable({ rows, selectedSupplierId, onSelectSupplier, onDeleteSupplier }: SupplierTableProps) {
   const t = useT();

   return (
      <div className="table-wrap">
         <table className="selectable-table sites-table">
            <thead>
               <tr>
                  <th>{t("suppliers.code")}</th>
                  <th>{t("suppliers.name")}</th>
                  <th>{t("suppliers.contactName")}</th>
                  <th>{t("suppliers.phone")}</th>
                  <th>{t("suppliers.status")}</th>
                  <th>{t("common.actions")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((supplier) => {
                  const isSelected = selectedSupplierId === supplier.id;
                  return (
                     <tr
                        key={supplier.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectSupplier(supplier.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectSupplier(supplier.id);
                           }
                        }}
                     >
                        <td>{supplier.code}</td>
                        <td>{supplier.name}</td>
                        <td>{formatValue(supplier.contactName)}</td>
                        <td>{formatValue(supplier.phone)}</td>
                        <td>
                           <Badge tone={statusTone(supplier.status)}>
                              {supplier.status === "Active" ? t("status.active") : t("status.inactive")}
                           </Badge>
                        </td>
                        <td>
                           <div className="table-actions">
                              <Button
                                 size="sm"
                                 variant="danger"
                                 onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteSupplier(supplier.id);
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
