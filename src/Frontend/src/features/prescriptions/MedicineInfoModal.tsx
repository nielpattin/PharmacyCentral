import { motion } from "motion/react";
import type { InventoryBalanceDto, ProductDto, ProductPriceDto } from "../../api/pharmacyClient";
import { Badge } from "../../components/shadcn/badge";
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
} from "../../components/shadcn/dialog";
import { useT } from "../../lib/i18n";
import styles from "./MedicineInfoModal.module.css";

type MedicineInfoModalProps = {
   product: ProductDto;
   balances: InventoryBalanceDto[];
   activePrice: ProductPriceDto | null;
   instructions: string[];
   onClose: () => void;
};

export function MedicineInfoModal({ product, balances, activePrice, instructions, onClose }: MedicineInfoModalProps) {
   const t = useT();
   const availableBalances = balances
      .map((balance) => ({ ...balance, availableQuantity: balance.quantityOnHand - balance.quantityReserved }))
      .filter((balance) => balance.availableQuantity > 0)
      .sort((left, right) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime());

   const shouldAnimate =
      typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

   const content = (
      <>
         <DialogHeader className={styles.header}>
            <DialogTitle>{product.name}</DialogTitle>
            <DialogDescription>{product.sku}</DialogDescription>
         </DialogHeader>
            <dl className={styles.detailsGrid}>
               <div>
                  <dt>{t("forms.unit")}</dt>
                  <dd>{product.unit ?? t("common.notAvailable")}</dd>
               </div>
               <div>
                  <dt>{t("forms.manufacturer")}</dt>
                  <dd>{product.manufacturer ?? t("common.notAvailable")}</dd>
               </div>
               <div>
                  <dt>{t("forms.barcode")}</dt>
                  <dd>{product.barcode ?? t("common.notAvailable")}</dd>
               </div>
               <div>
                  <dt>{t("counterSale.currentPrice")}</dt>
                  <dd>
                     {activePrice !== null
                        ? `${activePrice.unitPrice.toLocaleString()} ${activePrice.currency}`
                        : t("counterSale.noPrice")}
                  </dd>
               </div>
            </dl>

            <section className={styles.section}>
               <h3>{t("counterSale.availableBatches")}</h3>
               {availableBalances.length > 0 ? (
                  <div className={styles.batchList}>
                     {availableBalances.map((balance) => (
                        <div key={`${balance.productBatchId}-${balance.storageLocationId}`} className={styles.batchRow}>
                           <span>{balance.batchNumber}</span>
                           <Badge variant="outline">
                              {t("prescription.batchOption", {
                                 batchNumber: balance.batchNumber,
                                 expiryDate: new Date(balance.expiryDate).toLocaleDateString(),
                                 available: String(balance.availableQuantity),
                              })}
                           </Badge>
                        </div>
                     ))}
                  </div>
               ) : (
                  <p className={styles.muted}>{t("counterSale.outOfStock")}</p>
               )}
            </section>

            {instructions.length > 0 || product.notes !== null ? (
               <section className={styles.section}>
                  <h3>{t("counterSale.usageNotes")}</h3>
                  <ul className={styles.notesList}>
                     {instructions.map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                     ))}
                     {product.notes !== null ? <li>{product.notes}</li> : null}
                  </ul>
               </section>
            ) : null}
      </>
   );

   return (
      <Dialog open onOpenChange={(isOpen) => {
         if (!isOpen) onClose();
      }}>
         <DialogContent className={styles.modal}>
            {shouldAnimate ? (
               <motion.div
                  className={styles.motionContent}
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
               >
                  {content}
               </motion.div>
            ) : (
               <div className={styles.motionContent}>{content}</div>
            )}
         </DialogContent>
      </Dialog>
   );
}
