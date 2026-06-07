import { useEffect, useRef } from "react";
import type { PrintableInvoiceDetails } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";

type PrintableInvoiceModalProps = {
   invoice: PrintableInvoiceDetails;
   onClose: () => void;
};

export function PrintableInvoiceModal({ invoice, onClose }: PrintableInvoiceModalProps) {
   const t = useT();
   const printRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
         if (event.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
   }, [onClose]);

   const siteName = invoice.siteId;

   return (
      <div className="modal-overlay" onClick={onClose}>
         <div className="modal-content invoice-modal" onClick={(e) => e.stopPropagation()} ref={printRef}>
            <div className="invoice-print-area">
               <div className="invoice-header">
                  <h2>{t("invoice.title")}</h2>
                  <p className="invoice-site">{t("invoice.site")}: {siteName}</p>
               </div>

               <div className="invoice-meta">
                  <div><strong>{t("invoice.paymentCode")}:</strong> {invoice.paymentCode}</div>
                  <div><strong>{t("invoice.date")}:</strong> {new Date(invoice.createdAtUtc).toLocaleString()}</div>
                  <div><strong>{t("invoice.status")}:</strong> {t(`payment.status.${invoice.status}`)}</div>
                  {invoice.confirmedAtUtc !== null ? <div><strong>{t("invoice.confirmedAt")}:</strong> {new Date(invoice.confirmedAtUtc).toLocaleString()}</div> : null}
               </div>

               <table className="invoice-table">
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

               <div className="invoice-total">
                  <strong>{t("invoice.grandTotal")}:</strong> {invoice.totalAmount.toLocaleString()} {invoice.currency}
               </div>

               <div className="invoice-actions no-print">
                  <button className="btn btn-primary" onClick={() => window.print()}>{t("invoice.print")}</button>
                  <button className="btn btn-secondary" onClick={onClose}>{t("common.close")}</button>
               </div>
            </div>
         </div>
      </div>
   );
}
