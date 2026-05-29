import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { cancelPrescription, createPrescription, dispensePrescription, loadPrescription, loadPrescriptions, loadProducts, loadSites, loadStorageLocations, type PrescriptionCreateRequest, type PrescriptionDetails, type ProductDto, type SiteDto, type StorageLocationDto } from "../api/pharmacyClient";
import { PrescriptionDetail } from "../features/prescriptions/PrescriptionDetail";
import { PrescriptionForm } from "../features/prescriptions/PrescriptionForm";
import { PrescriptionTable } from "../features/prescriptions/PrescriptionTable";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { blankPrescriptionValues, type DispenseFormValues, type PrescriptionFormValues } from "./shared/prescriptionForms";

const PRESCRIPTION_STATUSES = ["Draft", "Pending", "Dispensed", "PartiallyDispensed", "Cancelled"];

export default function PrescriptionPage() {
   const t = useT();
   const [prescriptions, setPrescriptions] = useState<PrescriptionDetails[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [selectedId, setSelectedId] = useState("");
   const [siteFilter, setSiteFilter] = useState("");
   const [statusFilter, setStatusFilter] = useState("");
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [createToken, setCreateToken] = useState(0);

   const selectedPrescription = useMemo(() => prescriptions.find((prescription) => prescription.id === selectedId) ?? null, [prescriptions, selectedId]);
   const visiblePrescriptions = useMemo(() => prescriptions.filter((prescription) => (siteFilter === "" || prescription.siteId === siteFilter) && (statusFilter === "" || prescription.status === statusFilter)), [prescriptions, siteFilter, statusFilter]);
   const formValues = blankPrescriptionValues();

   useMountEffect(() => { void refreshData(); });

   async function refreshData(preferredSelectedId?: string) {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [prescriptionData, siteData, locationData, productData] = await Promise.all([loadPrescriptions({ limit: 100 }), loadSites(), loadStorageLocations(), loadProducts()]);
         setPrescriptions(prescriptionData);
         setSites(siteData);
         setStorageLocations(locationData);
         setProducts(productData);
         const nextSelectedId = preferredSelectedId ?? selectedId;
         setSelectedId(prescriptionData.some((prescription) => prescription.id === nextSelectedId) ? nextSelectedId : (prescriptionData[0]?.id ?? ""));
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadPrescription"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleSelectPrescription(id: string) {
      setSelectedId(id);
      setBannerError(null);
      try {
         const detail = await loadPrescription(id);
         setPrescriptions((current) => current.some((prescription) => prescription.id === detail.id) ? current.map((prescription) => prescription.id === detail.id ? detail : prescription) : [detail, ...current]);
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
            doctorName: values.doctorName?.trim() || null,
            doctorLicense: values.doctorLicense?.trim() || null,
            notes: values.notes?.trim() || null,
            lines: values.lines.map((line) => ({ productId: line.productId, prescribedQuantity: Number(line.prescribedQuantity), dosage: line.dosage?.trim() || null, frequency: line.frequency?.trim() || null, duration: line.duration?.trim() || null, notes: line.notes?.trim() || null })),
         };
         const result = await createPrescription(request);
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
         const request = { lines: values.lines.map((line) => ({ prescriptionLineId: line.prescriptionLineId, productBatchId: line.productBatchId, dispensedQuantity: Number(line.dispensedQuantity) })) };
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

   return (
      <AppShell active="prescriptions" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.prescription") }]} />}>
         <div className="sites-page">
            <PageHeader title={t("prescription.title")} actions={<div className="page-actions"><Button variant="primary" onClick={() => { setSelectedId(""); setCreateToken((current) => current + 1); }}>{t("prescription.newPrescription")}</Button></div>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <div className="site-workbench">
               <section className="card site-registry">
                  <div className="section">
                     <div className="section-header"><div><h2 className="section-title">{t("prescription.registry")}</h2><p className="section-subtitle">{t("prescription.registryDesc")}</p></div><Badge tone="role">{isLoading ? t("prescription.loadingState") : `${visiblePrescriptions.length} ${t("common.records")}`}</Badge></div>
                     <div className="section-toolbar"><select className="field-input" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">{t("prescription.allSites")}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select><select className="field-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">{t("prescription.allStatuses")}</option>{PRESCRIPTION_STATUSES.map((status) => <option key={status} value={status}>{t(`prescription.status.${status}`)}</option>)}</select></div>
                     {isLoading ? <EmptyState icon="…" title={t("prescription.loading")} description={t("prescription.fetching")} /> : visiblePrescriptions.length === 0 ? <EmptyState icon="0" title={t("prescription.emptyTitle")} description={t("prescription.emptyDesc")} /> : <PrescriptionTable rows={visiblePrescriptions} selectedId={selectedId} sites={sites} onSelect={(id) => { void handleSelectPrescription(id); }} />}
                  </div>
               </section>
               <aside className="card site-editor">
                  <div className="section">
                     <div className="section-header"><div><h2 className="section-title">{t("prescription.editor")}</h2><p className="section-subtitle">{t("prescription.editorDesc")}</p></div></div>
                     {selectedPrescription === null ? (
                        <PrescriptionForm key={`prescription-${createToken}`} initialValues={formValues} isSaving={isSaving} products={products} sites={sites} storageLocations={storageLocations} onSubmit={handleCreatePrescription} />
                     ) : (
                        <PrescriptionDetail key={selectedPrescription.id} prescription={selectedPrescription} isSaving={isSaving} products={products} sites={sites} storageLocations={storageLocations} onDispense={handleDispensePrescription} onCancel={handleCancelPrescription} />
                     )}
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
