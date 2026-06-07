import { motion } from "motion/react";
import { Badge } from "../../components/shadcn/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/shadcn/table";
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

export function GoodsReceiptTable({
   rows,
   selectedGoodsReceiptId,
   suppliers,
   sites,
   storageLocations,
   onSelectGoodsReceipt,
}: GoodsReceiptTableProps) {
   const t = useT();

   function supplierName(supplierId: string) {
      return suppliers.find((supplier) => supplier.id === supplierId)?.name ?? t("common.noData");
   }

   function siteName(siteId: string) {
      return sites.find((site) => site.id === siteId)?.name ?? t("common.noData");
   }

   function storageLocationName(storageLocationId: string) {
      return storageLocations.find((location) => location.id === storageLocationId)?.name ?? t("common.noData");
   }

   return (
      <Table>
         <TableHeader>
            <TableRow>
               <TableHead>{t("receiving.receiptNumber")}</TableHead>
               <TableHead>{t("receiving.supplier")}</TableHead>
               <TableHead>{t("receiving.site")}</TableHead>
               <TableHead>{t("receiving.location")}</TableHead>
               <TableHead>{t("receiving.status")}</TableHead>
               <TableHead>{t("receiving.receivedDate")}</TableHead>
               <TableHead>{t("receiving.lineCount")}</TableHead>
            </TableRow>
         </TableHeader>
         <TableBody>
            {rows.map((receipt, index) => {
               const isSelected = selectedGoodsReceiptId === receipt.id;
               return (
                  <motion.tr
                     key={receipt.id}
                     layout
                     initial={{ opacity: 0, y: 6 }}
                     animate={{ opacity: 1, y: 0 }}
                     transition={{ duration: 0.12, delay: index * 0.01, ease: [0.2, 0, 0, 1] }}
                     data-state={isSelected ? "selected" : undefined}
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
                     <TableCell>{receipt.receiptNumber}</TableCell>
                     <TableCell>{supplierName(receipt.supplierId)}</TableCell>
                     <TableCell>{siteName(receipt.siteId)}</TableCell>
                     <TableCell>{storageLocationName(receipt.storageLocationId)}</TableCell>
                     <TableCell>
                        <Badge variant="secondary">{formatValue(receipt.status)}</Badge>
                     </TableCell>
                     <TableCell>{new Date(receipt.receivedAtUtc).toLocaleDateString()}</TableCell>
                     <TableCell>{receipt.lines.length}</TableCell>
                  </motion.tr>
               );
            })}
         </TableBody>
      </Table>
   );
}
