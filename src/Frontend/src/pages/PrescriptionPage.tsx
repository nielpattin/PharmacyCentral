import { useMemo, useState } from "react";
import styles from "./PrescriptionPage.module.css";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/shadcn/button";
import { Card } from "../components/shadcn/card";
import {
   cancelPrescription,
   createPrescription,
   createPrescriptionPayment,
   dispensePrescription,
   getPaymentStatus,
   getPrintableInvoice,
   loadInventoryBalances,
   loadPrescriptions,
   loadProductPrices,
   loadProducts,
   loadSites,
   loadStorageLocations,
   type InventoryBalanceDto,
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

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredSelectedId?: string) {
      setBannerError(null);
      try {
         const [prescriptionData, siteData, locationData, productData, balanceData, priceData] = await Promise.all([
            loadPrescriptions({ limit: 100 }),
            loadSites(),
            loadStorageLocations(),
            loadProducts(),
            loadInventoryBalances(),
            loadProductPrices({ status: "Published", limit: 200 }),
         ]);
         setPrescriptions(prescriptionData);
         setSites(siteData);
         setStorageLocations(locationData);
         setProducts(productData);
         setBalances(balanceData);
         setPrices(priceData);
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

   return (
      <AppShell
         active="prescriptions"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("counterSale.title") }]} />
         }
      >
         <div className={styles.workspace}>
            <div className={styles.commandBar}>
               <PageHeader
                  title={t("counterSale.title")}
                  actions={
                     <div className="page-actions">
                        <Button
                           onClick={() => {
                              setSelectedId("");
                              setCreateToken((current) => current + 1);
                              setPayment(null);
                              setInvoiceData(null);
                           }}
                        >
                           {t("counterSale.newTicket")}
                        </Button>
                     </div>
                  }
               />
               {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            </div>

            <div className={styles.counterWorkbench}>
               <Card className={styles.counterTicket}>
                  {selectedPrescription === null ? (
                     <>
                        <div className={`section-header ${styles.editorHeader}`}>
                           <div>
                              <h2 className="section-title">{t("prescription.editor")}</h2>
                              <p className="section-subtitle">{t("prescription.editorDesc")}</p>
                           </div>
                        </div>
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
                     </>
                  ) : (
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
                  )}
               </Card>

               {selectedPrescription !== null ? (
                  <aside className={styles.counterCheckout}>
                     <PaymentPanel
                        key={`payment-${selectedPrescription.id}`}
                        payment={payment}
                        onCreatePayment={handleCreatePayment}
                        onRefreshStatus={handleRefreshPaymentStatus}
                        onShowInvoice={handleShowInvoice}
                        isBusy={isPaymentBusy}
                     />
                  </aside>
               ) : null}
            </div>

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
