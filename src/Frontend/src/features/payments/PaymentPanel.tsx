import { useState } from "react";
import type { PaymentDetails } from "../../api/pharmacyClient";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { useT } from "../../lib/i18n";
import { mapPaymentError } from "../../lib/errorMapping";
import styles from "./PaymentPanel.module.css";

type PaymentPanelProps = {
   payment: PaymentDetails | null;
   onCreatePayment: () => Promise<void>;
   onRefreshStatus: () => Promise<void>;
   onShowInvoice: () => void;
   isBusy: boolean;
};

function paymentStatusTone(status: string) {
   if (status === "Paid") return "ok";
   if (status === "Pending") return "warn";
   if (status === "Failed" || status === "Expired") return "bad";
   return "role";
}

export function PaymentPanel({ payment, onCreatePayment, onRefreshStatus, onShowInvoice, isBusy }: PaymentPanelProps) {
   const t = useT();
   const [error, setError] = useState<string | null>(null);

   if (payment === null) {
      return (
         <div className={styles.checkoutEmpty}>
            <div className={styles.checkoutEmptyIcon}>💳</div>
            <h3>{t("payment.title")}</h3>
            <p>{t("payment.noPaymentDesc")}</p>
            <div className={styles.checkoutFormActions}>
               <Button variant="primary" onClick={async () => { setError(null); try { await onCreatePayment(); } catch (e) { setError(mapPaymentError(e, t)); } }} disabled={isBusy}>{t("payment.createPayment")}</Button>
            </div>
            {error !== null ? <div className="notice danger-note">{error}</div> : null}
         </div>
      );
   }

   return (
      <div className={`entity-form ${styles.panel}`}>
         <div className="section-header">
            <div><h3 className="section-title">{t("payment.title")}</h3><p className="section-subtitle">{t("payment.desc")}</p></div>
            <Badge tone={paymentStatusTone(payment.status)}>{t(`payment.status.${payment.status}`)}</Badge>
         </div>

         <div className={styles.paymentInfo}>
            <div className={styles.paymentCode}><strong>{t("payment.paymentCode")}:</strong> {payment.paymentCode}</div>
            <div className={styles.paymentAmount}><strong>{t("payment.amount")}:</strong> {payment.totalAmount.toLocaleString()} {payment.currency}</div>
         </div>

         {payment.paymentInstruction !== null && payment.status === "Pending" ? (
            <div className={styles.paymentQrSection}>
               <div className={styles.paymentQrContainer}>
                  <img src={payment.paymentInstruction.qrImageUrl} alt={t("payment.qrAlt")} className={styles.paymentQrImage} />
               </div>
               <div className={styles.paymentTransferDetails}>
                  <div><strong>{t("payment.bank")}:</strong> {payment.paymentInstruction.bankName}</div>
                  <div><strong>{t("payment.accountNumber")}:</strong> {payment.paymentInstruction.accountNumber}</div>
                  <div><strong>{t("payment.transferContent")}:</strong> {payment.paymentInstruction.transferContent}</div>
               </div>
               <div className={styles.paymentFormActions}>
                  <Button variant="secondary" onClick={async () => { setError(null); try { await onRefreshStatus(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} disabled={isBusy}>{t("payment.refreshStatus")}</Button>
                  <Button variant="primary" onClick={onShowInvoice}>{t("payment.viewInvoice")}</Button>
               </div>
            </div>
         ) : null}

         {payment.status === "Paid" ? (
            <div className={styles.paymentFormActions}>
               <p className={styles.paymentPaidMessage}>{t("payment.paidMessage")}</p>
               <Button variant="primary" onClick={onShowInvoice}>{t("payment.viewInvoice")}</Button>
            </div>
         ) : null}

         {error !== null ? <div className="notice danger-note">{error}</div> : null}
      </div>
   );
}
