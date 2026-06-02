import { useState, type ReactNode } from "react";
import { AppShell } from "../components/layout/AppShell";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import {
   loadDashboardSummary,
   loadSites,
   type DashboardActivityDto,
   type DashboardSummaryDto,
   type SiteDto,
} from "../api/pharmacyClient";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { useMountEffect } from "../hooks/useMountEffect";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

function auditActionTone(action: string) {
   if (action === "Deleted" || action === "Cancelled") return "bad";
   if (action === "Updated") return "warn";
   return "ok";
}

function DashboardStat({ label, value }: { label: string; value: string | number }) {
   return (
      <div className="stat">
         <span>{label}</span>
         <strong>{value}</strong>
      </div>
   );
}

function SummarySection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
   return (
      <section className="card dashboard-section">
         <div className="section">
            <div className="section-header">
               <div>
                  <h2 className="section-title">{title}</h2>
                  <p className="section-subtitle">{description}</p>
               </div>
            </div>
            <div className="stat-row dashboard-stat-row">{children}</div>
         </div>
      </section>
   );
}

function RecentActivityList({ activity, sites }: { activity: DashboardActivityDto[]; sites: SiteDto[] }) {
   const t = useT();
   const siteName = (siteId: string | null) =>
      siteId === null ? t("audit.system") : (sites.find((site) => site.id === siteId)?.name ?? siteId);

   if (activity.length === 0) {
      return <EmptyState icon="0" title={t("dashboard.noActivityTitle")} description={t("dashboard.noActivityDesc")} />;
   }

   return (
      <div className="dashboard-activity-list">
         {activity.map((entry) => (
            <article key={entry.id} className="dashboard-activity-item">
               <div>
                  <div className="module-head">
                     <Badge tone={auditActionTone(entry.action)}>{t(`audit.action.${entry.action}`)}</Badge>
                     <h3>{t(`audit.entity.${entry.entityType}`)}</h3>
                  </div>
                  <p>{entry.summary ?? entry.entityId ?? t("common.noData")}</p>
                  <span>{siteName(entry.siteId)}</span>
               </div>
               <time>{new Date(entry.occurredAtUtc).toLocaleString()}</time>
            </article>
         ))}
      </div>
   );
}

export default function DashboardPage() {
   const t = useT();
   const authUser = useAuth();
   const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [siteFilter, setSiteFilter] = useState("");
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const numberFormatter = new Intl.NumberFormat();

   useMountEffect(() => {
      void refreshData("");
   });

   async function refreshData(nextSiteId = siteFilter) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [summaryData, siteData] = await Promise.all([loadDashboardSummary({ siteId: nextSiteId }), loadSites()]);
         setSummary(summaryData);
         setSites(siteData);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadDashboard"));
      } finally {
         setIsLoading(false);
      }
   }

   function handleSiteFilterChange(value: string) {
      setSiteFilter(value);
      void refreshData(value);
   }

   const metric = (value: number | undefined) =>
      isLoading || summary === null ? "..." : numberFormatter.format(value ?? 0);

   return (
      <AppShell
         active="dashboard"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.dashboard") }]} />
         }
      >
         <PageHeader
            title={t("dashboard.title")}
            description={t("dashboard.description")}
            actions={
               <div className="page-actions">
                  <select
                     className="field-input"
                     value={siteFilter}
                     onChange={(event) => handleSiteFilterChange(event.target.value)}
                  >
                     <option value="">{t("dashboard.allSites")}</option>
                     {sites.map((site) => (
                        <option key={site.id} value={site.id}>
                           {site.name}
                        </option>
                     ))}
                  </select>
                  <Button variant="secondary" onClick={() => void refreshData()}>
                     {t("common.refresh")}
                  </Button>
               </div>
            }
         />

         {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}

         <SummarySection title={t("dashboard.structureMetrics")} description={t("dashboard.structureMetricsDesc")}>
            <DashboardStat label={t("dashboard.totalSites")} value={metric(summary?.totalSites)} />
            <DashboardStat label={t("dashboard.activeSites")} value={metric(summary?.activeSites)} />
            <DashboardStat label={t("dashboard.storageLocations")} value={metric(summary?.totalStorageLocations)} />
            <DashboardStat label={t("dashboard.activeLocations")} value={metric(summary?.activeStorageLocations)} />
         </SummarySection>

         <SummarySection title={t("dashboard.inventoryMetrics")} description={t("dashboard.inventoryMetricsDesc")}>
            <DashboardStat label={t("dashboard.totalProducts")} value={metric(summary?.totalProducts)} />
            <DashboardStat label={t("dashboard.totalSuppliers")} value={metric(summary?.totalSuppliers)} />
            <DashboardStat label={t("dashboard.quantityOnHand")} value={metric(summary?.totalQuantityOnHand)} />
            <DashboardStat label={t("dashboard.quantityReserved")} value={metric(summary?.totalQuantityReserved)} />
         </SummarySection>

         <SummarySection title={t("dashboard.attentionMetrics")} description={t("dashboard.attentionMetricsDesc")}>
            <DashboardStat label={t("dashboard.lowStockBatches")} value={metric(summary?.lowStockBatchCount)} />
            <DashboardStat label={t("dashboard.expiringBatches")} value={metric(summary?.expiringBatchCount)} />
            <DashboardStat label={t("dashboard.pendingTransfers")} value={metric(summary?.pendingTransferCount)} />
            <DashboardStat label={t("dashboard.openPrescriptions")} value={metric(summary?.openPrescriptionCount)} />
            <DashboardStat label={t("dashboard.openStocktakes")} value={metric(summary?.openStocktakeCount)} />
            <DashboardStat label={t("dashboard.pendingAdjustments")} value={metric(summary?.pendingAdjustmentCount)} />
         </SummarySection>

         <section className="card dashboard-section">
            <div className="section">
               <div className="section-header">
                  <div>
                     <h2 className="section-title">{t("dashboard.recentActivity")}</h2>
                     <p className="section-subtitle">{t("dashboard.recentActivityDesc")}</p>
                  </div>
                  {authUser?.isPlatformAdmin ? (
                     <a className="btn secondary" href="/dashboard/audit">
                        {t("dashboard.openAudit")}
                     </a>
                  ) : null}
               </div>
               {isLoading || summary === null ? (
                  <EmptyState icon="…" title={t("status.loading")} description={t("dashboard.recentActivityDesc")} />
               ) : (
                  <RecentActivityList activity={summary.recentActivity} sites={sites} />
               )}
            </div>
         </section>

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
