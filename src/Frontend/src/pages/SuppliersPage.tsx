import styles from "./SuppliersPage.module.css";
import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { createSupplier, deleteSupplier, loadSuppliers, updateSupplier, type SupplierDto, type SupplierUpsertRequest } from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { SupplierForm } from "../features/suppliers/SupplierForm";
import { SupplierTable } from "../features/suppliers/SupplierTable";
import { blankSupplierValues, normalizeText, supplierValuesFromDto, type SupplierFormValues } from "./shared/pharmacyForms";

export default function SuppliersPage() {
   const t = useT();
   const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [selectedSupplierId, setSelectedSupplierId] = useState("");
   const [editorTargetId, setEditorTargetId] = useState<string | null>(null);
   const [query, setQuery] = useState("");
   const [isSaving, setIsSaving] = useState(false);
   const [isDeleting, setIsDeleting] = useState(false);
   const [createToken, setCreateToken] = useState(0);

   const selectedSupplier = useMemo(() => suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null, [selectedSupplierId, suppliers]);

   const visibleSuppliers = useMemo(() => {
      const normalizedQuery = query.trim().toLowerCase();
      if (normalizedQuery === "") {
         return suppliers;
      }

      return suppliers.filter((supplier) =>
         [supplier.code, supplier.name, supplier.contactName ?? "", supplier.email ?? "", supplier.phone ?? "", supplier.address ?? "", supplier.status, supplier.notes ?? ""].some((value) =>
            value.toLowerCase().includes(normalizedQuery),
         ),
      );
   }, [query, suppliers]);

   const editorSupplier = editorTargetId === null ? null : (suppliers.find((supplier) => supplier.id === editorTargetId) ?? selectedSupplier);
   const editorMode = editorTargetId === null ? "create" : "edit";
   const formValues: SupplierFormValues = editorSupplier === null ? blankSupplierValues() : supplierValuesFromDto(editorSupplier);
   const formKey = `${editorTargetId ?? `new-supplier-${createToken}`}-${JSON.stringify(formValues)}`;

   useMountEffect(() => {
      void refreshSuppliers();
   });

   async function refreshSuppliers(preferredSelectedSupplierId?: string) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const data = await loadSuppliers();
         setSuppliers(data);

         const nextSelectedSupplierId = preferredSelectedSupplierId ?? selectedSupplierId;
         const resolvedSelectedSupplierId = data.some((supplier) => supplier.id === nextSelectedSupplierId)
            ? nextSelectedSupplierId
            : (data[0]?.id ?? "");

         setSelectedSupplierId(resolvedSelectedSupplierId);
         setEditorTargetId((current) => {
            if (current === null) {
               return null;
            }

            return data.some((supplier) => supplier.id === current) ? current : resolvedSelectedSupplierId || null;
         });
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadSuppliers"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleSaveSupplier(values: SupplierFormValues) {
      setIsSaving(true);
      setBannerError(null);

      try {
         const request: SupplierUpsertRequest = {
            code: normalizeText(values.code),
            name: normalizeText(values.name),
            contactName: values.contactName.trim(),
            email: values.email.trim(),
            phone: values.phone.trim(),
            address: values.address.trim(),
            status: normalizeText(values.status) || "Active",
            notes: values.notes.trim(),
            isActive: values.isActive,
         };

         const result = editorTargetId === null ? await createSupplier(request) : await updateSupplier(editorTargetId, request);
         await refreshSuppliers(result.id);
         setEditorTargetId(result.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveSupplier"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleDeleteSupplier(supplierId: string) {
      const supplier = suppliers.find((item) => item.id === supplierId);
      if (supplier === undefined || !window.confirm(t("suppliers.confirmDelete", { code: supplier.code }))) {
         return;
      }

      setIsDeleting(true);
      setBannerError(null);

      try {
         await deleteSupplier(supplierId);
         await refreshSuppliers();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.deleteSupplier"));
      } finally {
         setIsDeleting(false);
      }
   }

   function handleSelectSupplier(supplierId: string) {
      setSelectedSupplierId(supplierId);
      setEditorTargetId(supplierId);
   }

   function handleNewSupplier() {
      setCreateToken((current) => current + 1);
      setSelectedSupplierId("");
      setEditorTargetId(null);
   }

   return (
      <AppShell active="supplier" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.supplier") }]} />}>
         <div className={styles.sitesPage}>
            <PageHeader title={t("suppliers.title")} actions={<div className="page-actions"><Button variant="primary" onClick={handleNewSupplier}>{t("suppliers.newSupplier")}</Button></div>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <div className={styles.siteWorkbench}>
               <section className={`card ${styles.siteRegistry}`}>
                  <div className="section">
                     <div className="section-header">
                        <div><h2 className="section-title">{t("suppliers.registry")}</h2><p className="section-subtitle">{t("suppliers.registryDesc")}</p></div>
                        <Badge tone="role">{isLoading ? t("suppliers.loadingState") : `${visibleSuppliers.length} ${t("common.records")}`}</Badge>
                     </div>
                     <div className="section-toolbar">
                        <input className={`field-input ${styles.siteSearch}`} type="search" placeholder={t("suppliers.searchPlaceholder")} aria-label={t("suppliers.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />
                     </div>
                     {isLoading ? <EmptyState icon="…" title={t("suppliers.loading")} description={t("suppliers.fetching")} /> : suppliers.length === 0 ? <EmptyState icon="0" title={t("suppliers.emptyTitle")} description={t("suppliers.emptyDesc")} /> : visibleSuppliers.length === 0 ? <EmptyState icon="?" title={t("suppliers.emptyTitle")} description={t("suppliers.searchPlaceholder")} /> : <SupplierTable rows={visibleSuppliers} selectedSupplierId={selectedSupplier?.id ?? ""} onSelectSupplier={handleSelectSupplier} onDeleteSupplier={(supplierId) => void handleDeleteSupplier(supplierId)} />}
                  </div>
               </section>
               <aside className={`card ${styles.siteEditor}`}>
                  <div className="section">
                     <div className="section-header"><div><h2 className="section-title">{t("suppliers.editor")}</h2><p className="section-subtitle">{t("suppliers.editorDesc")}</p></div></div>
                     <SupplierForm key={formKey} mode={editorMode} initialValues={formValues} isSaving={isSaving || isDeleting} onSubmit={handleSaveSupplier} onDelete={editorSupplier !== null ? () => handleDeleteSupplier(editorSupplier.id) : undefined} />
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
