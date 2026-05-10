import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { loadPharmacyData, type SiteDto, type StorageLocationDto } from "../api/pharmacyClient";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";

export default function DashboardPage() {
   const t = useT();
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);

   useMountEffect(() => {
      void (async () => {
         setIsLoading(true);
         setBannerError(null);

         try {
            const data = await loadPharmacyData();
            setSites(data.sites);
            setStorageLocations(data.storageLocations);
         } catch (error) {
            setBannerError(error instanceof Error ? error.message : t("errors.loadDashboard"));
         } finally {
            setIsLoading(false);
         }
      })();
   });

   const activeSites = sites.filter((site) => site.isActive).length;
   const activeLocations = storageLocations.filter((location) => location.isActive).length;

   return (
      <AppShell
         active="dashboard"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.dashboard") }]} />
         }
      >
         <PageHeader title={t("dashboard.title")} description={t("dashboard.description")} />

         {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}

         <div className="stat-row">
            <div className="stat">
               <span>{t("dashboard.totalSites")}</span>
               <strong>{isLoading ? "..." : sites.length}</strong>
            </div>
            <div className="stat">
               <span>{t("dashboard.activeSites")}</span>
               <strong>{isLoading ? "..." : activeSites}</strong>
            </div>
            <div className="stat">
               <span>{t("dashboard.storageLocations")}</span>
               <strong>{isLoading ? "..." : storageLocations.length}</strong>
            </div>
            <div className="stat">
               <span>{t("dashboard.activeLocations")}</span>
               <strong>{isLoading ? "..." : activeLocations}</strong>
            </div>
         </div>

         <section className="card dashboard-section">
            <div className="section">
               <div className="section-header">
                  <div>
                     <h2 className="section-title">{t("dashboard.operationsBoard")}</h2>
                     <p className="section-subtitle">{t("dashboard.operationsBoardDesc")}</p>
                  </div>
               </div>

               <div className="module-list">
                  <article className="module-row">
                     <div className="module-copy">
                        <div className="module-head">
                           <h3>{t("dashboard.sites")}</h3>
                        </div>
                        <p>{t("dashboard.snapshot")}</p>
                     </div>
                     <div className="module-actions">
                        <a className="btn secondary" href="/dashboard/sites">
                           {t("dashboard.openSites")}
                        </a>
                     </div>
                  </article>

                  <article className="module-row">
                     <div className="module-copy">
                        <div className="module-head">
                           <h3>{t("dashboard.prescription")}</h3>
                        </div>
                        <p>{t("dashboard.prescriptionDesc")}</p>
                     </div>
                     <div className="module-actions">
                        <a className="btn secondary" href="/dashboard/prescriptions">
                           {t("common.open")}
                        </a>
                     </div>
                  </article>

                  <article className="module-row">
                     <div className="module-copy">
                        <div className="module-head">
                           <h3>{t("dashboard.transfer")}</h3>
                        </div>
                        <p>{t("dashboard.transferDesc")}</p>
                     </div>
                     <div className="module-actions">
                        <a className="btn secondary" href="/dashboard/transfers">
                           {t("common.open")}
                        </a>
                     </div>
                  </article>
               </div>
            </div>
         </section>

         {!isLoading && sites.length === 0 ? (
            <EmptyState icon="0" title={t("dashboard.noSitesTitle")} description={t("dashboard.noSitesDesc")} />
         ) : null}
      </AppShell>
   );
}
