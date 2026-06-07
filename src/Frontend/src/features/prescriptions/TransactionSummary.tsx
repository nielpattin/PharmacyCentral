import { Badge } from "../../components/shadcn/badge";
import { useT } from "../../lib/i18n";
import styles from "./TransactionSummary.module.css";

type TransactionSummaryProps = {
   productCount: number;
   totalQuantity: number;
   totalAmount: number;
   currency: string;
   missingPriceCount: number;
};

export function TransactionSummary({
   productCount,
   totalQuantity,
   totalAmount,
   currency,
   missingPriceCount,
}: TransactionSummaryProps) {
   const t = useT();
   const paymentLabel = missingPriceCount > 0 ? t("counterSale.needsPriceCheck") : t("payment.status.Pending");

   return (
      <section className={styles.summary} aria-label={t("counterSale.transactionSummary")}>
         <div className={styles.summaryHeader}>
            <div>
               <h3>{t("counterSale.transactionSummary")}</h3>
               <p>{t("counterSale.transactionSummaryDesc")}</p>
            </div>
            <Badge variant={missingPriceCount > 0 ? "destructive" : "outline"}>{paymentLabel}</Badge>
         </div>
         <div className={styles.summaryGrid}>
            <div>
               <span>{t("counterSale.summaryProductCount")}</span>
               <strong>{productCount}</strong>
            </div>
            <div>
               <span>{t("counterSale.summaryTotalQuantity")}</span>
               <strong>{totalQuantity}</strong>
            </div>
            <div>
               <span>{t("counterSale.summaryTotalAmount")}</span>
               <strong>
                  {totalAmount.toLocaleString()} {currency}
               </strong>
            </div>
            <div>
               <span>{t("counterSale.deliveryStatus")}</span>
               <strong>{t("counterSale.deliveryStatusPending")}</strong>
            </div>
         </div>
      </section>
   );
}
