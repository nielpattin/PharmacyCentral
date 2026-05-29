import { Badge } from "../../components/ui/Badge";
import type { GoodsReceiptDto, SiteDto, StorageLocationDto, SupplierDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { formatValue } from "../../pages/shared/pharmacyForms";

type GoodsReceiptTableProps = {
   rows: GoodsReceiptDto[];
   selectedGoodsReceiptId: string;
   suppliers: SupplierDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onSelectGoodsReceipt: (goodsReceiptId: string) => void;
};

export function GoodsReceiptTable({ rows, selectedGoodsReceiptId, suppliers, sites, storageLocations, onSelectGoodsReceipt }: GoodsReceiptTableProps) {
   const t = useT();

   function supplierName(supplierId: string) {
      return suppliers.find((supplier) => supplier.id === supplierId)?.name ?? supplierId;
   }

   function siteName(siteId: string) {
      return sites.find((site) => site.id === siteId)?.name ?? siteId;
   }

   function storageLocationName(storageLocationId: string) {
      return storageLocations.find((location) => location.id === storageLocationId)?.name ?? storageLocationId;
   }

   return (
      <div className="table-wrap">
         <table className="selectable-table sites-table">
            <thead>
               <tr>
                  <th>{t("receiving.receiptNumber")}</th>
                  <th>{t("receiving.supplier")}</th>
                  <th>{t("receiving.site")}</th>
                  <th>{t("receiving.location")}</th>
                  <th>{t("receiving.status")}</th>
                  <th>{t("receiving.receivedDate")}</th>
                  <th>{t("receiving.lineCount")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((receipt) => {
                  const isSelected = selectedGoodsReceiptId === receipt.id;
                  return (
                     <tr
                        key={receipt.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectGoodsReceipt(receipt.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectGoodsReceipt(receipt.id);
                           }
                        }}
                     >
                        <td>{receipt.receiptNumber}</td>
                        <td>{supplierName(receipt.supplierId)}</td>
                        <td>{siteName(receipt.siteId)}</td>
                        <td>{storageLocationName(receipt.storageLocationId)}</td>
                        <td><Badge tone="ok">{formatValue(receipt.status)}</Badge></td>
                        <td>{new Date(receipt.receivedAtUtc).toLocaleDateString()}</td>
                        <td>{receipt.lines.length}</td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
