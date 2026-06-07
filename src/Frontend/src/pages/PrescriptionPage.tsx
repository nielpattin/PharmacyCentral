import { useMemo, useState } from "react";
import styles from "./PrescriptionPage.module.css";
import { AppShell } from "../components/layout/AppShell";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/shadcn/button";
import { Card } from "../components/shadcn/card";
import {
   cancelPrescription,
   confirmCounterPayment,
   createPrescription,
   createPrescriptionPayment,
   dispensePrescription,
   getPaymentStatus,
   getPrintableInvoice,
   loadCounterTransactions,
   loadInventoryBalances,
   loadPrescriptions,
   loadProductPrices,
   loadProducts,
   loadSites,
   loadStorageLocations,
   refundPayment,
   type InventoryBalanceDto,
   type CounterTransactionDetails,
   type PaymentDetails,
   type PrintableInvoiceDetails,
   type PrescriptionCreateRequest,
   type PrescriptionDetails,
   type ProductDto,
   type ProductPriceDto,
   type SiteDto,
   type StorageLocationDto,
} from "../api/pharmacyClient";
import { PaymentPanel } from "../features/payments/PaymentPanel";
import { PrintableInvoiceModal } from "../features/payments/PrintableInvoiceModal";
import { PrescriptionDetail } from "../features/prescriptions/PrescriptionDetail";
import { PrescriptionForm } from "../features/prescriptions/PrescriptionForm";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import {
   blankPrescriptionValues,
   type DispenseFormValues,
   type PrescriptionFormValues,
} from "./shared/prescriptionForms";

export default function PrescriptionPage() {
   const authUser = useAuth();
   const t = useT();
   const [prescriptions, setPrescriptions] = useState<PrescriptionDetails[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [selectedId, setSelectedId] = useState("");
   const [isSaving, setIsSaving] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [createToken, setCreateToken] = useState(0);
   const [payment, setPayment] = useState<PaymentDetails | null>(null);
   const [invoiceData, setInvoiceData] = useState<PrintableInvoiceDetails | null>(null);
   const [isPaymentBusy, setIsPaymentBusy] = useState(false);
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [prices, setPrices] = useState<ProductPriceDto[]>([]);
   const [transactions, setTransactions] = useState<CounterTransactionDetails[]>([]);
   const [activeCounterTab, setActiveCounterTab] = useState<"create" | "history">("create");
   const [transactionFilter, setTransactionFilter] = useState<"all" | "today" | "Pending" | "Paid" | "Cancelled" | "Refunded">("today");
   const selectedPrescription = useMemo(
      () => prescriptions.find((prescription) => prescription.id === selectedId) ?? null,
      [prescriptions, selectedId],
   );

   const defaultSource = useMemo(() => {
      const userSites =
         authUser !== null && !authUser.isPlatformAdmin ? sites.filter((s) => authUser.siteIds.includes(s.id)) : sites;
      const defaultSite = userSites.find((s) => s.isActive) ?? userSites[0] ?? null;
      if (defaultSite === null) {
         return { siteId: "", storageLocationId: "", siteName: "", storageLocationName: "", sourceMissing: true };
      }
      const siteLocations = storageLocations.filter((l) => l.siteId === defaultSite.id);
      const defaultLocation = siteLocations.find((l) => l.isActive) ?? siteLocations[0] ?? null;
      if (defaultLocation === null) {
         return {
            siteId: defaultSite.id,
            storageLocationId: "",
            siteName: defaultSite.name,
            storageLocationName: "",
            sourceMissing: true,
         };
      }
      return {
         siteId: defaultSite.id,
         storageLocationId: defaultLocation.id,
         siteName: defaultSite.name,
         storageLocationName: defaultLocation.name,
         sourceMissing: false,
      };
   }, [sites, storageLocations, authUser]);
   const formValues = blankPrescriptionValues(t("counterSale.walkInCustomer"), {
      siteId: defaultSource.siteId,
      storageLocationId: defaultSource.storageLocationId,
   });
   const invoiceSiteName = useMemo(
      () =>
         invoiceData === null
            ? ""
            : (sites.find((site) => site.id === invoiceData.siteId)?.name ?? t("counterSale.unknownSite")),
      [invoiceData, sites, t],
   );

   const visibleTransactions = useMemo(() => {
      if (transactionFilter === "all") {
         return transactions;
      }

      if (transactionFilter === "today") {
         const today = new Date().toDateString();
         return transactions.filter((transaction) => new Date(transaction.createdAtUtc).toDateString() === today);
      }

      if (transactionFilter === "Cancelled") {
         return transactions.filter((transaction) => transaction.prescriptionStatus === "Cancelled");
      }

      return transactions.filter((transaction) => transaction.paymentStatus === transactionFilter);
   }, [transactions, transactionFilter]);


   function formatTransactionAmount(transaction: CounterTransactionDetails) {
      if (transaction.totalAmount === null || transaction.currency === null) {
         return t("counterSale.notAvailable");
      }

      return `${transaction.totalAmount.toLocaleString()} ${transaction.currency}`;
   }

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredSelectedId?: string) {
      setBannerError(null);
      try {
         const [prescriptionData, siteData, locationData, productData, balanceData, priceData, transactionData] = await Promise.all([
            loadPrescriptions({ limit: 100 }),
            loadSites(),
            loadStorageLocations(),
            loadProducts(),
            loadInventoryBalances(),
            loadProductPrices({ status: "Published", limit: 200 }),
            loadCounterTransactions({ limit: 100 }),
         ]);
         setPrescriptions(prescriptionData);
         setSites(siteData);
         setStorageLocations(locationData);
         setProducts(productData);
         setBalances(balanceData);
         setPrices(priceData);
         setTransactions(transactionData);
         setSelectedId(
            preferredSelectedId !== undefined && prescriptionData.some((p) => p.id === preferredSelectedId)
               ? preferredSelectedId
               : "",
         );
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadPrescription"));
      }
   }

   async function handleCreatePrescription(values: PrescriptionFormValues) {
      setIsSaving(true);
      setBannerError(null);
      try {
         const request: PrescriptionCreateRequest = {
            siteId: values.siteId,
            storageLocationId: values.storageLocationId,
            patientName: values.patientName.trim(),
            patientPhone: values.patientPhone?.trim() || null,
            doctorName: null,
            doctorLicense: null,
            notes: values.notes?.trim() || null,
            lines: values.lines.map((line) => ({
               productId: line.productId,
               prescribedQuantity: Number(line.prescribedQuantity),
               dosage: line.dosage?.trim() || null,
               frequency: line.frequency?.trim() || null,
               duration: line.duration?.trim() || null,
               notes: line.notes?.trim() || null,
            })),
         };
         const result = await createPrescription(request);
         setPayment(null);
         setInvoiceData(null);
         await refreshData(result.id);
         setCreateToken((current) => current + 1);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrescription"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleDispensePrescription(values: DispenseFormValues) {
      if (selectedPrescription === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const request = {
            lines: values.lines.map((line) => ({
               prescriptionLineId: line.prescriptionLineId,
               productBatchId: line.productBatchId,
               dispensedQuantity: Number(line.dispensedQuantity),
            })),
         };
         await dispensePrescription(selectedPrescription.id, request);
         await refreshData(selectedPrescription.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrescription"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleCancelPrescription() {
      if (selectedPrescription === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         await cancelPrescription(selectedPrescription.id);
         await refreshData(selectedPrescription.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrescription"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleCreatePayment() {
      if (selectedPrescription === null) return;
      setIsPaymentBusy(true);
      try {
         const paymentData = await createPrescriptionPayment(selectedPrescription.id);
         setPayment(paymentData);
      } finally {
         setIsPaymentBusy(false);
      }
   }

   async function handleRefreshPaymentStatus() {
      if (payment === null) return;
      setIsPaymentBusy(true);
      try {
         const paymentData = await getPaymentStatus(payment.id);
         setPayment(paymentData);
      } finally {
         setIsPaymentBusy(false);
      }
   }

   async function handleConfirmCounterPayment(method: "Cash" | "ManualTransfer") {
      if (payment === null) return;
      setIsPaymentBusy(true);
      try {
         const paymentData = await confirmCounterPayment(payment.id, method);
         setPayment(paymentData);
      } finally {
         setIsPaymentBusy(false);
      }
   }

   async function handleRefundPayment(reason: string) {
      if (payment === null) return;
      setIsPaymentBusy(true);
      try {
         const paymentData = await refundPayment(payment.id, reason);
         setPayment(paymentData);
      } finally {
         setIsPaymentBusy(false);
      }
   }

   async function handleShowInvoice() {
      if (payment === null) return;
      setIsPaymentBusy(true);
      try {
         const invoice = await getPrintableInvoice(payment.id);
         setInvoiceData(invoice);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadPrescription"));
      } finally {
         setIsPaymentBusy(false);
      }
   }

   async function handleOpenTransaction(transaction: CounterTransactionDetails) {
      setSelectedId(transaction.prescriptionId);
      setActiveCounterTab("create");
      setInvoiceData(null);

      if (transaction.paymentId === null) {
         setPayment(null);
         return;
      }

      setIsPaymentBusy(true);
      try {
         const paymentData = await getPaymentStatus(transaction.paymentId);
         setPayment(paymentData);
      } finally {
         setIsPaymentBusy(false);
      }
   }

   async function handleShowTransactionInvoice(transaction: CounterTransactionDetails) {
      if (transaction.paymentId === null) return;

      setIsPaymentBusy(true);
      try {
         const invoice = await getPrintableInvoice(transaction.paymentId);
         setInvoiceData(invoice);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadPrescription"));
      } finally {
         setIsPaymentBusy(false);
      }
   }

   return (
      <AppShell active="prescriptions">
         <div className={styles.workspace}>
            <div className={styles.commandBar}>
               <div className={styles.commandHeader}>
                  <PageHeader title={t("counterSale.title")} />
                  <div className={styles.counterTabs} role="tablist" aria-label={t("counterSale.tabsLabel")}>
                     <Button
                        type="button"
                        variant={activeCounterTab === "create" ? "default" : "outline"}
                        onClick={() => setActiveCounterTab("create")}
                     >
                        {t("counterSale.createTransactionTab")}
                     </Button>
                     <Button
                        type="button"
                        variant={activeCounterTab === "history" ? "default" : "outline"}
                        onClick={() => setActiveCounterTab("history")}
                     >
                        {t("counterSale.transactionHistoryTab")}
                     </Button>
                  </div>
               </div>
               {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            </div>

            {activeCounterTab === "create" ? (
               <div className={`${styles.counterWorkbench}${selectedPrescription === null ? ` ${styles.createWorkbench}` : ""}`}>
                  {selectedPrescription === null ? (
                     <div className={styles.counterTicket}>
                        <PrescriptionForm
                           key={`prescription-${createToken}-${defaultSource.siteId}-${defaultSource.storageLocationId}`}
                           initialValues={formValues}
                           isSaving={isSaving}
                           products={products}
                           sites={sites}
                           storageLocations={storageLocations}
                           balances={balances}
                           prices={prices}
                           onSubmit={handleCreatePrescription}
                        />
                     </div>
                  ) : (
                     <Card className={styles.counterTicket}>
                        <PrescriptionDetail
                           key={selectedPrescription.id}
                           prescription={selectedPrescription}
                           isSaving={isSaving}
                           products={products}
                           sites={sites}
                           storageLocations={storageLocations}
                           balances={balances}
                           onDispense={handleDispensePrescription}
                           onCancel={handleCancelPrescription}
                        />
                     </Card>
                  )}
                  {selectedPrescription !== null ? (
                     <aside className={styles.counterCheckout}>
                        <PaymentPanel
                           key={`payment-${selectedPrescription.id}`}
                           payment={payment}
                           onCreatePayment={handleCreatePayment}
                           onConfirmCounterPayment={handleConfirmCounterPayment}
                           onRefundPayment={handleRefundPayment}
                           onRefreshStatus={handleRefreshPaymentStatus}
                           onShowInvoice={handleShowInvoice}
                           isBusy={isPaymentBusy}
                        />
                     </aside>
                  ) : null}
               </div>
            ) : (
               <Card className={styles.historyCard}>
                  <div className={styles.historyHeader}>
                     <div>
                        <h2>{t("counterSale.transactionHistoryTab")}</h2>
                        <p>{t("counterSale.transactionHistoryDesc")}</p>
                     </div>
                  </div>
                  <div className={styles.historyFilters}>
                     {(["today", "all", "Pending", "Paid", "Cancelled", "Refunded"] as const).map((filter) => (
                        <Button
                           key={filter}
                           type="button"
                           variant={transactionFilter === filter ? "default" : "outline"}
                           onClick={() => setTransactionFilter(filter)}
                        >
                           {t(`counterSale.transactionFilter.${filter}`)}
                        </Button>
                     ))}
                  </div>
                  <div className={styles.historyTableWrap}>
                     <table className={styles.historyTable}>
                        <thead>
                           <tr>
                              <th>{t("counterSale.transactionCode")}</th>
                              <th>{t("counterSale.customer")}</th>
                              <th>{t("counterSale.transactionDate")}</th>
                              <th>{t("counterSale.paymentStatus")}</th>
                              <th>{t("counterSale.totalAmount")}</th>
                              <th>{t("common.actions")}</th>
                           </tr>
                        </thead>
                        <tbody>
                           {visibleTransactions.map((transaction) => (
                              <tr key={transaction.prescriptionId}>
                                 <td>{transaction.prescriptionNumber}</td>
                                 <td>
                                    <strong>{transaction.customerName}</strong>
                                    {transaction.customerPhone !== null ? <span>{transaction.customerPhone}</span> : null}
                                 </td>
                                 <td>{new Date(transaction.createdAtUtc).toLocaleDateString()}</td>
                                 <td>{t(`payment.status.${transaction.paymentStatus}`)}</td>
                                 <td>{formatTransactionAmount(transaction)}</td>
                                 <td>
                                    <div className={styles.historyActions}>
                                       <Button type="button" variant="outline" onClick={() => void handleOpenTransaction(transaction)}>
                                          {t("counterSale.openTransaction")}
                                       </Button>
                                       <Button
                                          type="button"
                                          disabled={!transaction.canPrintInvoice}
                                          onClick={() => void handleShowTransactionInvoice(transaction)}
                                       >
                                          {t("counterSale.reprintInvoice")}
                                       </Button>
                                    </div>
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                     {visibleTransactions.length === 0 ? (
                        <div className={styles.historyEmpty}>{t("counterSale.noTransactions")}</div>
                     ) : null}
                  </div>
               </Card>
            )}

            {invoiceData !== null ? (
               <PrintableInvoiceModal
                  invoice={invoiceData}
                  siteName={invoiceSiteName}
                  onClose={() => setInvoiceData(null)}
               />
            ) : null}
         </div>
      </AppShell>
   );
}
