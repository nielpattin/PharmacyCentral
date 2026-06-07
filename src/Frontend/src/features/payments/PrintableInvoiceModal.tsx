import { useRef } from "react";
import type { PrintableInvoiceDetails } from "../../api/pharmacyClient";
import { Button } from "../../components/ui/Button";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useT } from "../../lib/i18n";
import styles from "./PrintableInvoiceModal.module.css";

type PrintableInvoiceModalProps = {
   invoice: PrintableInvoiceDetails;
   onClose: () => void;
   siteName: string;
};

export function PrintableInvoiceModal({ invoice, siteName, onClose }: PrintableInvoiceModalProps) {
   const t = useT();
   const printRef = useRef<HTMLDivElement>(null);

   useMountEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
         if (event.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
   });

   return (
      <div className="modal-overlay" onClick={onClose}>
         <div className={`modal-content ${styles.invoiceModal}`} onClick={(e) => e.stopPropagation()} ref={printRef}>
            <div className={styles.invoicePrintArea}>
               <div className={styles.invoiceHeader}>
                  <h2>{t("invoice.title")}</h2>
                  <p className={styles.invoiceSite}>{t("invoice.site")}: {siteName}</p>
               </div>

               <div className={styles.invoiceMeta}>
                  <div><strong>{t("invoice.paymentCode")}:</strong> {invoice.paymentCode}</div>
                  <div><strong>{t("invoice.date")}:</strong> {new Date(invoice.createdAtUtc).toLocaleString()}</div>
                  <div><strong>{t("invoice.status")}:</strong> {t(`payment.status.${invoice.status}`)}</div>
                  {invoice.confirmedAtUtc !== null ? <div><strong>{t("invoice.confirmedAt")}:</strong> {new Date(invoice.confirmedAtUtc).toLocaleString()}</div> : null}
               </div>

               <table className={styles.invoiceTable}>
                  <thead>
                     <tr>
                        <th>{t("invoice.product")}</th>
                        <th>{t("invoice.unitPrice")}</th>
                        <th>{t("invoice.quantity")}</th>
                        <th>{t("invoice.total")}</th>
                     </tr>
                  </thead>
                  <tbody>
                     {invoice.lines.map((line) => (
                        <tr key={line.id}>
                           <td>{line.productName}</td>
                           <td>{line.unitPrice.toLocaleString()} {line.currency}</td>
                           <td>{line.quantity}</td>
                           <td>{line.lineTotal.toLocaleString()} {line.currency}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>

               <div className={styles.invoiceTotal}>
                  <strong>{t("invoice.grandTotal")}:</strong> {invoice.totalAmount.toLocaleString()} {invoice.currency}
               </div>

               <div className={`${styles.invoiceActions} ${styles.noPrint}`}>
                  <Button variant="primary" onClick={() => window.print()}>{t("invoice.print")}</Button>
                  <Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>
               </div>
            </div>
         </div>
      </div>
   );
}
