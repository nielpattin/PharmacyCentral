import { useMemo } from "react";
import type { InventoryBalanceDto, SiteDto, StorageLocationDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";

export type InventoryBalanceTableProps = {
   rows: InventoryBalanceDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onUseBalance?: (balance: InventoryBalanceDto) => void;
};

export function InventoryBalanceTable({ rows, sites, storageLocations, onUseBalance }: InventoryBalanceTableProps) {
   const t = useT();
   const sortedRows = useMemo(
      () =>
         [...rows].sort(
            (left, right) =>
               left.productSku.localeCompare(right.productSku) || left.expiryDate.localeCompare(right.expiryDate),
         ),
      [rows],
   );

   function siteName(siteId: string) {
      return sites.find((site) => site.id === siteId)?.name ?? siteId;
   }

   function storageLocationName(storageLocationId: string) {
      return storageLocations.find((location) => location.id === storageLocationId)?.name ?? storageLocationId;
   }

   return (
      <div className="overflow-x-auto">
         <table className="w-full border-collapse text-sm">
            <thead>
               <tr>
                  <th>{t("inventory.sku")}</th>
                  <th>{t("inventory.productName")}</th>
                  <th>{t("inventory.batchNumber")}</th>
                  <th>{t("inventory.expiryDate")}</th>
                  <th>{t("inventory.site")}</th>
                  <th>{t("inventory.location")}</th>
                  <th>{t("inventory.quantityOnHand")}</th>
                  <th>{t("inventory.quantityReserved")}</th>
                  {onUseBalance !== undefined ? <th>{t("common.actions")}</th> : null}
               </tr>
            </thead>
            <tbody>
               {sortedRows.map((balance) => (
                  <tr key={balance.id}>
                     <td>{balance.productSku}</td>
                     <td>{balance.productName}</td>
                     <td>{balance.batchNumber}</td>
                     <td>{new Date(balance.expiryDate).toLocaleDateString()}</td>
                     <td>{siteName(balance.siteId)}</td>
                     <td>{storageLocationName(balance.storageLocationId)}</td>
                     <td>{balance.quantityOnHand}</td>
                     <td>{balance.quantityReserved}</td>
                     {onUseBalance !== undefined ? (
                        <td>
                           <button type="button" className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground" onClick={() => onUseBalance(balance)}>
                              {t("inventory.useForMovement")}
                           </button>
                        </td>
                     ) : null}
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   );
}
