import styles from "./SitesPage.module.css";
import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { EmptyState } from "../components/ui/EmptyState";
import { navigate } from "../lib/router";
import {
   createSite,
   deleteSite,
   loadSites,
   updateSite,
   type SiteDto,
   type SiteUpsertRequest,
} from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { SiteForm } from "../features/sites/SiteForm";
import { SiteTable } from "../features/sites/SiteTable";
import { normalizeSiteTypeValue } from "./shared/pharmacyTypes";
import { blankSiteValues, normalizeText, siteValuesFromDto, type SiteFormValues } from "./shared/pharmacyForms";

export default function SitesPage() {
   const t = useT();
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [selectedSiteId, setSelectedSiteId] = useState("");
   const [siteEditorTargetId, setSiteEditorTargetId] = useState<string | null>(null);
   const [siteQuery, setSiteQuery] = useState("");
   const [isSavingSite, setIsSavingSite] = useState(false);
   const [isDeletingSite, setIsDeletingSite] = useState(false);
   const [siteCreateToken, setSiteCreateToken] = useState(0);

   const selectedSite = useMemo(() => {
      return sites.find((site) => site.id === selectedSiteId) ?? null;
   }, [selectedSiteId, sites]);

   const visibleSites = useMemo(() => {
      const query = siteQuery.trim().toLowerCase();
      if (query === "") {
         return sites;
      }

      return sites.filter((site) =>
         [site.code, site.name, site.siteType, site.status, site.address ?? "", site.notes ?? ""].some((value) =>
            value.toLowerCase().includes(query),
         ),
      );
   }, [siteQuery, sites]);

   const siteEditorSite =
      siteEditorTargetId === null ? null : (sites.find((site) => site.id === siteEditorTargetId) ?? selectedSite);
   const siteEditorMode = siteEditorTargetId === null ? "create" : "edit";
   const siteFormValues: SiteFormValues =
      siteEditorSite === null ? blankSiteValues() : siteValuesFromDto(siteEditorSite);
   const siteFormKey = `${siteEditorTargetId ?? `new-site-${siteCreateToken}`}-${JSON.stringify(siteFormValues)}`;

   useMountEffect(() => {
      void refreshSites();
   });

   async function refreshSites(preferredSelectedSiteId?: string) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const data = await loadSites();
         setSites(data);

         const nextSelectedSiteId = preferredSelectedSiteId ?? selectedSiteId;
         const resolvedSelectedSiteId = data.some((site) => site.id === nextSelectedSiteId)
            ? nextSelectedSiteId
            : (data[0]?.id ?? "");

         setSelectedSiteId(resolvedSelectedSiteId);
         setSiteEditorTargetId((current) => {
            if (current === null) {
               return null;
            }

            return data.some((site) => site.id === current) ? current : resolvedSelectedSiteId || null;
         });
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadSites"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleSaveSite(values: SiteFormValues) {
      setIsSavingSite(true);
      setBannerError(null);

      try {
         const request: SiteUpsertRequest = {
            code: normalizeText(values.code),
            name: normalizeText(values.name),
            siteType: normalizeSiteTypeValue(normalizeText(values.siteType)) as SiteUpsertRequest["siteType"],
            status: normalizeText(values.status) || "Active",
            address: values.address.trim(),
            notes: values.notes.trim(),
            isActive: values.isActive,
         };

         const result =
            siteEditorTargetId === null ? await createSite(request) : await updateSite(siteEditorTargetId, request);
         await refreshSites(result.id);
         setSiteEditorTargetId(result.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveSite"));
      } finally {
         setIsSavingSite(false);
      }
   }

   async function handleDeleteSite(siteId: string) {
      const site = sites.find((item) => item.id === siteId);
      if (site === undefined) {
         return;
      }

      if (!window.confirm(t("sites.confirmDelete", { code: site.code }))) {
         return;
      }

      setIsDeletingSite(true);
      setBannerError(null);

      try {
         await deleteSite(siteId);
         await refreshSites();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.deleteSite"));
      } finally {
         setIsDeletingSite(false);
      }
   }

   function handleSelectSite(siteId: string) {
      setSelectedSiteId(siteId);
      setSiteEditorTargetId(siteId);
   }

   function handleNewSite() {
      setSiteCreateToken((current) => current + 1);
      setSelectedSiteId("");
      setSiteEditorTargetId(null);
   }

   function handleOpenStorageLocations(siteId: string) {
      navigate(`/dashboard/sites/${siteId}/storage-locations`);
   }

   return (
      <AppShell
         active="sites"
         breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.sites") }]} />}
      >
         <div className={styles.sitesPage}>
            <PageHeader
               title={t("sites.title")}
               actions={
                  <div className="page-actions">
                     <Button onClick={handleNewSite}>{t("common.newSite")}</Button>
                  </div>
               }
            />

            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}

            <div className={styles.siteWorkbench}>
               <section
                  className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.siteRegistry}`}
               >
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("sites.registry")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("sites.registryDesc")}</p>
                        </div>
                        <Badge variant="outline">
                           {isLoading ? t("sites.loadingState") : `${visibleSites.length} ${t("sites.records")}`}
                        </Badge>
                     </div>

                     <div className="flex flex-wrap items-center gap-2">
                        <input
                           className={`h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${styles.siteSearch}`}
                           type="search"
                           placeholder={t("sites.searchPlaceholder")}
                           aria-label={t("sites.searchPlaceholder")}
                           value={siteQuery}
                           onChange={(event) => setSiteQuery(event.target.value)}
                        />
                     </div>

                     {isLoading ? (
                        <EmptyState icon="…" title={t("sites.loading")} description={t("sites.fetching")} />
                     ) : sites.length === 0 ? (
                        <EmptyState icon="0" title={t("sites.emptyTitle")} description={t("sites.emptyDesc")} />
                     ) : visibleSites.length === 0 ? (
                        <EmptyState icon="?" title={t("sites.emptyTitle")} description={t("sites.searchPlaceholder")} />
                     ) : (
                        <SiteTable
                           rows={visibleSites}
                           selectedSiteId={selectedSite?.id ?? ""}
                           onSelectSite={handleSelectSite}
                           onOpenStorageLocations={handleOpenStorageLocations}
                           onDeleteSite={(siteId) => void handleDeleteSite(siteId)}
                        />
                     )}
                  </div>
               </section>

               <aside
                  className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.siteEditor}`}
               >
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("sites.editor")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("sites.editorDesc")}</p>
                        </div>
                     </div>

                     <SiteForm
                        key={siteFormKey}
                        mode={siteEditorMode}
                        initialValues={siteFormValues}
                        isSaving={isSavingSite || isDeletingSite}
                        onSubmit={handleSaveSite}
                        onDelete={siteEditorSite !== null ? () => handleDeleteSite(siteEditorSite.id) : undefined}
                     />
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
