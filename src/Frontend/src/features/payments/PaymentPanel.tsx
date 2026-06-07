import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { PaymentDetails } from "../../api/pharmacyClient";
import { Badge } from "../../components/shadcn/badge";
import { Button } from "../../components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/shadcn/card";
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

function paymentStatusVariant(status: string) {
   if (status === "Paid") return "secondary" as const;
   if (status === "Failed" || status === "Expired") return "destructive" as const;
   return "outline" as const;
}

export function PaymentPanel({ payment, onCreatePayment, onRefreshStatus, onShowInvoice, isBusy }: PaymentPanelProps) {
   const t = useT();
   const [error, setError] = useState<string | null>(null);
   const stateKey = payment === null ? "not-created" : payment.status;

   async function createPayment() {
      setError(null);
      try {
         await onCreatePayment();
      } catch (errorValue) {
         setError(mapPaymentError(errorValue, t));
      }
   }

   async function refreshPaymentStatus() {
      setError(null);
      try {
         await onRefreshStatus();
      } catch (errorValue) {
         setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
      }
   }

   return (
      <Card className={styles.panelCard}>
         <CardHeader className={styles.panelHeader}>
            <div>
               <CardTitle className={styles.panelTitle}>{t("payment.title")}</CardTitle>
               <CardDescription>{payment === null ? t("payment.noPaymentDesc") : t("payment.desc")}</CardDescription>
            </div>
            {payment !== null ? (
               <Badge variant={paymentStatusVariant(payment.status)} className={styles.paymentStatusBadge}>
                  {t(`payment.status.${payment.status}`)}
               </Badge>
            ) : null}
         </CardHeader>

         <CardContent className={styles.panelContent}>
            <AnimatePresence mode="wait">
               <motion.div
                  key={stateKey}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                  className={styles.paymentState}
               >
                  {payment === null ? (
                     <div className={styles.checkoutEmpty}>
                        <div className={styles.checkoutEmptyIcon}>💳</div>
                        <Button onClick={() => void createPayment()} disabled={isBusy}>
                           {t("payment.createPayment")}
                        </Button>
                     </div>
                  ) : (
                     <>
                        <div className={styles.paymentInfo}>
                           <div className={styles.paymentInfoRow}>
                              <span>{t("payment.paymentCode")}</span>
                              <strong>{payment.paymentCode}</strong>
                           </div>
                           <div className={styles.paymentInfoRow}>
                              <span>{t("payment.amount")}</span>
                              <strong>
                                 {payment.totalAmount.toLocaleString()} {payment.currency}
                              </strong>
                           </div>
                        </div>

                        {payment.paymentInstruction !== null && payment.status === "Pending" ? (
                           <div className={styles.paymentQrSection}>
                              <div className={styles.paymentQrContainer}>
                                 <img
                                    src={payment.paymentInstruction.qrImageUrl}
                                    alt={t("payment.qrAlt")}
                                    className={styles.paymentQrImage}
                                 />
                              </div>
                              <div className={styles.paymentTransferDetails}>
                                 <div>
                                    <strong>{t("payment.bank")}:</strong> {payment.paymentInstruction.bankName}
                                 </div>
                                 <div>
                                    <strong>{t("payment.accountNumber")}:</strong>{" "}
                                    {payment.paymentInstruction.accountNumber}
                                 </div>
                                 <div>
                                    <strong>{t("payment.transferContent")}:</strong>{" "}
                                    {payment.paymentInstruction.transferContent}
                                 </div>
                              </div>
                              <div className={styles.paymentFormActions}>
                                 <Button
                                    variant="outline"
                                    onClick={() => void refreshPaymentStatus()}
                                    disabled={isBusy}
                                 >
                                    {t("payment.refreshStatus")}
                                 </Button>
                                 <Button onClick={onShowInvoice}>{t("payment.viewInvoice")}</Button>
                              </div>
                           </div>
                        ) : null}

                        {payment.status === "Paid" ? (
                           <div className={styles.paymentFormActions}>
                              <p className={styles.paymentPaidMessage}>{t("payment.paidMessage")}</p>
                              <Button onClick={onShowInvoice}>{t("payment.viewInvoice")}</Button>
                           </div>
                        ) : null}
                     </>
                  )}
               </motion.div>
            </AnimatePresence>

            {error !== null ? <div className="notice danger-note">{error}</div> : null}
         </CardContent>
      </Card>
   );
}
