import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import {
   createStorageLocation,
   deleteStorageLocation,
   loadPharmacyData,
   updateStorageLocation,
   type SiteDto,
   type StorageLocationDto,
   type StorageLocationUpsertRequest,
} from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { StorageLocationForm } from "../features/storage-locations/StorageLocationForm";
import { StorageLocationTable } from "../features/storage-locations/StorageLocationTable";
import { normalizeStorageLocationTypeValue } from "./shared/pharmacyTypes";
import {
   blankStorageLocationValues,
   normalizeText,
   parseCapacity,
   statusTone,
   storageLocationValuesFromDto,
   type StorageLocationFormValues,
} from "./shared/pharmacyForms";

type StorageLocationsPageProps = {
   siteId: string;
};

export default function StorageLocationsPage({ siteId }: StorageLocationsPageProps) {
   const t = useT();
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [selectedStorageLocationId, setSelectedStorageLocationId] = useState("");
   const [storageEditorTargetId, setStorageEditorTargetId] = useState<string | null>(null);
   const [isSavingStorageLocation, setIsSavingStorageLocation] = useState(false);
   const [isDeletingStorageLocation, setIsDeletingStorageLocation] = useState(false);
   const [storageCreateToken, setStorageCreateToken] = useState(0);

   const selectedSite = useMemo(() => {
      return sites.find((site) => site.id === siteId) ?? null;
   }, [siteId, sites]);

   const selectedStorageLocations = useMemo(() => {
      return storageLocations.filter((location) => location.siteId === siteId);
   }, [siteId, storageLocations]);

   const selectedStorageLocation = useMemo(() => {
      if (selectedStorageLocations.length === 0) {
         return null;
      }

      return (
         selectedStorageLocations.find((location) => location.id === selectedStorageLocationId) ??
         selectedStorageLocations[0]
      );
   }, [selectedStorageLocationId, selectedStorageLocations]);

   const storageEditorLocation =
      storageEditorTargetId === null
         ? null
         : (storageLocations.find((location) => location.id === storageEditorTargetId) ?? selectedStorageLocation);
   const storageEditorMode = storageEditorTargetId === null ? "create" : "edit";
   const storageFormValues: StorageLocationFormValues =
      storageEditorLocation === null
         ? blankStorageLocationValues(selectedSite?.id ?? "")
         : storageLocationValuesFromDto(storageEditorLocation);
   const storageFormKey = `${storageEditorTargetId ?? selectedSite?.id ?? `new-storage-${storageCreateToken}`}-${JSON.stringify(storageFormValues)}`;
   const breadcrumb =
      selectedSite === null ? (
         <Breadcrumbs
            items={[
               { label: t("app.brand"), href: "/dashboard" },
               { label: t("nav.sites"), href: "/dashboard/sites" },
               { label: t("storage.storageLocations") },
            ]}
         />
      ) : (
         <Breadcrumbs
            items={[
               { label: t("app.brand"), href: "/dashboard" },
               { label: t("nav.sites"), href: "/dashboard/sites" },
               { label: selectedSite.code },
            ]}
         />
      );

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredSelectedStorageLocationId?: string) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const data = await loadPharmacyData();
         setSites(data.sites);
         setStorageLocations(data.storageLocations);

         const nextSelectedStorageLocationId = preferredSelectedStorageLocationId ?? selectedStorageLocationId;
         const resolvedSelectedStorageLocationId = data.storageLocations.some(
            (location) => location.id === nextSelectedStorageLocationId && location.siteId === siteId,
         )
            ? nextSelectedStorageLocationId
            : (data.storageLocations.find((location) => location.siteId === siteId)?.id ?? "");

         setSelectedStorageLocationId(resolvedSelectedStorageLocationId);
         setStorageEditorTargetId((current) => {
            if (current === null) {
               return null;
            }

            return data.storageLocations.some((location) => location.id === current && location.siteId === siteId)
               ? current
               : resolvedSelectedStorageLocationId || null;
         });
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadStorageLocations"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleSaveStorageLocation(values: StorageLocationFormValues) {
      setIsSavingStorageLocation(true);
      setBannerError(null);

      try {
         const request: StorageLocationUpsertRequest = {
            siteId: values.siteId,
            code: normalizeText(values.code),
            name: normalizeText(values.name),
            locationType: normalizeStorageLocationTypeValue(
               normalizeText(values.locationType),
            ) as StorageLocationUpsertRequest["locationType"],
            status: normalizeText(values.status) || "Active",
            capacity: parseCapacity(values.capacity),
            isActive: values.isActive,
         };

         const result =
            storageEditorTargetId === null
               ? await createStorageLocation(request)
               : await updateStorageLocation(storageEditorTargetId, request);
         await refreshData(result.id);
         setStorageEditorTargetId(result.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveStorageLocation"));
      } finally {
         setIsSavingStorageLocation(false);
      }
   }

   async function handleDeleteStorageLocation(storageLocationId: string) {
      const location = storageLocations.find((item) => item.id === storageLocationId);
      if (location === undefined) {
         return;
      }

      if (!window.confirm(t("storage.confirmDelete", { code: location.code }))) {
         return;
      }

      setIsDeletingStorageLocation(true);
      setBannerError(null);

      try {
         await deleteStorageLocation(storageLocationId);
         await refreshData();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.deleteStorageLocation"));
      } finally {
         setIsDeletingStorageLocation(false);
      }
   }

   function handleSelectStorageLocation(storageLocationId: string) {
      setSelectedStorageLocationId(storageLocationId);
      setStorageEditorTargetId(storageLocationId);
   }

   function handleNewStorageLocation() {
      setStorageCreateToken((current) => current + 1);
      setSelectedStorageLocationId("");
      setStorageEditorTargetId(null);
   }

   return (
      <AppShell active="sites" breadcrumb={breadcrumb}>
         <PageHeader
            title={t("storage.title")}
            description={
               selectedSite === null
                  ? t("storage.missingSiteDescription")
                  : t("storage.description", { code: selectedSite.code, name: selectedSite.name })
            }
            actions={
               <div className="page-actions">
                  <Button variant="secondary" onClick={() => void refreshData()}>
                     {t("storage.refresh")}
                  </Button>
                  <Button variant="primary" onClick={handleNewStorageLocation} disabled={selectedSite === null}>
                     {t("storage.newLocation")}
                  </Button>
               </div>
            }
         />

         {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}

         {selectedSite === null ? (
            <div style={{ marginTop: "14px" }}>
               <EmptyState icon="?" title={t("storage.siteNotFound")} description={t("storage.useBackToSites")} />
            </div>
         ) : (
            <div className="split split-crud" style={{ marginTop: "14px" }}>
               <section className="card">
                  <div className="section">
                     <div className="section-header">
                        <div>
                           <h2 className="section-title">{t("storage.linked")}</h2>
                           <p className="section-subtitle">{t("storage.linkedDesc", { code: selectedSite.code })}</p>
                        </div>
                        <Badge tone={statusTone(selectedSite.status)}>
                           {selectedSite.status === "Active" ? t("status.active") : t("status.inactive")}
                        </Badge>
                     </div>

                     {isLoading ? (
                        <EmptyState icon="…" title={t("storage.loading")} description={t("storage.fetching")} />
                     ) : selectedStorageLocations.length === 0 ? (
                        <EmptyState icon="0" title={t("storage.emptyTitle")} description={t("storage.emptyDesc")} />
                     ) : (
                        <StorageLocationTable
                           rows={selectedStorageLocations}
                           selectedStorageLocationId={selectedStorageLocation?.id ?? ""}
                           onSelectStorageLocation={handleSelectStorageLocation}
                           onDeleteStorageLocation={(storageLocationId) =>
                              void handleDeleteStorageLocation(storageLocationId)
                           }
                        />
                     )}
                  </div>
               </section>

               <section className="card">
                  <div className="section">
                     <StorageLocationForm
                        key={storageFormKey}
                        mode={storageEditorMode}
                        sites={sites}
                        initialValues={storageFormValues}
                        isSaving={isSavingStorageLocation || isDeletingStorageLocation}
                        onSubmit={handleSaveStorageLocation}
                        onDelete={
                           storageEditorLocation !== null
                              ? () => handleDeleteStorageLocation(storageEditorLocation.id)
                              : undefined
                        }
                     />
                  </div>
               </section>
            </div>
         )}
      </AppShell>
   );
}
