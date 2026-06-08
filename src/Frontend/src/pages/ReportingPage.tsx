import { useMemo, useState, type ReactNode } from "react";
import {
   loadDashboardSummary,
   loadInventoryBalances,
   loadSites,
   loadStorageLocations,
   type DashboardActivityDto,
   type DashboardSummaryDto,
   type InventoryBalanceDto,
   type SiteDto,
   type StorageLocationDto,
} from "../api/pharmacyClient";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { EmptyState } from "../components/ui/EmptyState";
import { useMountEffect } from "../hooks/useMountEffect";
import { useAuth } from "../lib/auth";
import { canAccessPath } from "../lib/access";
import { useT } from "../lib/i18n";
import { formatAuditSummary } from "../lib/auditDisplay";
import styles from "./ReportingPage.module.css";

type CountSummary = {
   label: string;
   count: number;
};

type RiskLevel = "low" | "expiring" | "both";

type InventoryRiskRow = {
   balance: InventoryBalanceDto;
   level: RiskLevel;
   daysToExpiry: number | null;
};

const expiringWindowDays = 30;
const lowAvailableThreshold = 10;

function auditActionTone(action: string) {
   if (action === "Deleted" || action === "Cancelled") return "destructive";
   if (action === "Updated") return "outline";
   return "secondary";
}

function daysUntil(date: string) {
   const expiryTime = new Date(date).getTime();
   if (!Number.isFinite(expiryTime)) {
      return null;
   }

   return Math.ceil((expiryTime - Date.now()) / (24 * 60 * 60 * 1000));
}

function availableQuantity(balance: InventoryBalanceDto) {
   return balance.quantityOnHand - balance.quantityReserved;
}

function isLowStock(balance: InventoryBalanceDto) {
   return balance.quantityOnHand > 0 && availableQuantity(balance) <= lowAvailableThreshold;
}

function isNearExpiry(balance: InventoryBalanceDto) {
   const daysToExpiry = daysUntil(balance.expiryDate);
   return balance.quantityOnHand > 0 && daysToExpiry !== null && daysToExpiry <= expiringWindowDays;
}

function getRiskLevel(balance: InventoryBalanceDto): RiskLevel | null {
   const low = isLowStock(balance);
   const expiry = isNearExpiry(balance);

   if (low && expiry) {
      return "both";
   }

   if (low) {
      return "low";
   }

   if (expiry) {
      return "expiring";
   }

   return null;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
   const counts = new Map<string, number>();

   for (const item of items) {
      const key = getKey(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
   }

   return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function formatQuantity(value: number) {
   return new Intl.NumberFormat().format(value);
}

function formatOptionalDateTime(value: Date | null) {
   return value === null ? "" : value.toLocaleString();
}

function ReportingStat({ label, value }: { label: string; value: string | number }) {
   return (
      <div className={styles.reportingStat}>
         <span>{label}</span>
         <strong>{value}</strong>
      </div>
   );
}

function ReportingSection({
   title,
   description,
   children,
}: {
   title: string;
   description: string;
   children: ReactNode;
}) {
   return (
      <section
         className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.dashboardSection}`}
      >
         <div className="p-4">
            <div className="flex items-start justify-between gap-3">
               <div>
                  <h2 className="m-0 text-sm font-semibold text-foreground">{title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{description}</p>
               </div>
            </div>
            {children}
         </div>
      </section>
   );
}

function ReportingSourceStrip({ lastLoadedAt }: { lastLoadedAt: Date | null }) {
   const t = useT();

   return (
      <section
         className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.dashboardSection} ${styles.reportingSourceStrip}`}
      >
         <div className={`section ${styles.reportingSourceContent}`}>
            <div>
               <h2 className="m-0 text-sm font-semibold text-foreground">{t("reporting.sourceTitle")}</h2>
               <p className="mt-1 text-sm text-muted-foreground">
                  {lastLoadedAt === null
                     ? t("reporting.sourceDesc")
                     : t("reporting.sourceDescWithTime", { time: formatOptionalDateTime(lastLoadedAt) })}
               </p>
            </div>
            <div className={styles.reportingSourceBadges} aria-label={t("reporting.sourceTitle")}>
               <Badge variant="outline">{t("reporting.sourceDashboard")}</Badge>
               <Badge variant="outline">{t("reporting.sourceInventory")}</Badge>
               <Badge variant="outline">{t("reporting.sourceAudit")}</Badge>
            </div>
         </div>
      </section>
   );
}

function CountList({
   items,
   emptyTitle,
   emptyDescription,
}: {
   items: CountSummary[];
   emptyTitle: string;
   emptyDescription: string;
}) {
   if (items.length === 0) {
      return <EmptyState icon="0" title={emptyTitle} description={emptyDescription} />;
   }

   return (
      <div className={`${styles.moduleList} ${styles.reportingCountList}`}>
         {items.map((item) => (
            <article key={item.label} className={`${styles.moduleRow} ${styles.reportingCountRow}`}>
               <div className={styles.moduleCopy}>
                  <div className={styles.moduleHead}>
                     <h3>{item.label}</h3>
                  </div>
               </div>
               <div className={styles.moduleActions}>
                  <Badge variant="outline">{formatQuantity(item.count)}</Badge>
               </div>
            </article>
         ))}
      </div>
   );
}

function RecentAuditList({ logs, sites }: { logs: DashboardActivityDto[]; sites: SiteDto[] }) {
   const t = useT();
   const siteName = (siteId: string | null) =>
      siteId === null
         ? t("audit.system")
         : (sites.find((site) => site.id === siteId)?.name ?? t("reporting.unknownSite"));

   if (logs.length === 0) {
      return <EmptyState icon="0" title={t("reporting.noActivityTitle")} description={t("reporting.noActivityDesc")} />;
   }

   return (
      <div className={styles.dashboardActivityList}>
         {logs.slice(0, 6).map((entry) => (
            <article key={entry.id} className={styles.dashboardActivityItem}>
               <div>
                  <div className={styles.moduleHead}>
                     <Badge variant={auditActionTone(entry.action)}>{t(`audit.action.${entry.action}`)}</Badge>
                     <h3>{t(`audit.entity.${entry.entityType}`)}</h3>
                  </div>
                  <p>{formatAuditSummary(t, entry.summary, entry.entityId ?? t("common.noData"))}</p>
                  <span>{siteName(entry.siteId)}</span>
               </div>
               <time>{new Date(entry.occurredAtUtc).toLocaleString()}</time>
            </article>
         ))}
      </div>
   );
}

function InventoryRiskTable({
   balances,
   sites,
   storageLocations,
}: {
   balances: InventoryBalanceDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
}) {
   const t = useT();
   const riskRows: InventoryRiskRow[] = balances
      .map((balance) => {
         const level = getRiskLevel(balance);
         return level === null ? null : { balance, level, daysToExpiry: daysUntil(balance.expiryDate) };
      })
      .filter((row): row is InventoryRiskRow => row !== null)
      .sort((left, right) => {
         const rank = { both: 0, expiring: 1, low: 2 } satisfies Record<RiskLevel, number>;
         return (
            rank[left.level] - rank[right.level] ||
            (left.daysToExpiry ?? Number.MAX_SAFE_INTEGER) - (right.daysToExpiry ?? Number.MAX_SAFE_INTEGER) ||
            availableQuantity(left.balance) - availableQuantity(right.balance)
         );
      })
      .slice(0, 8);
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? t("reporting.unknownSite");
   const locationName = (locationId: string) =>
      storageLocations.find((location) => location.id === locationId)?.name ?? t("reporting.unknownLocation");

   if (riskRows.length === 0) {
      return (
         <EmptyState
            icon="✓"
            title={t("reporting.noInventoryRiskTitle")}
            description={t("reporting.noInventoryRiskDesc")}
         />
      );
   }

   return (
      <div className={`overflow-x-auto ${styles.reportingRiskTableWrap}`}>
         <table className={styles.reportingRiskTable}>
            <thead>
               <tr>
                  <th>{t("reporting.product")}</th>
                  <th>{t("reporting.location")}</th>
                  <th>{t("reporting.available")}</th>
                  <th>{t("reporting.expiry")}</th>
                  <th>{t("reporting.risk")}</th>
               </tr>
            </thead>
            <tbody>
               {riskRows.map((row) => {
                  const riskLabel =
                     row.level === "both"
                        ? t("reporting.lowAndExpiring")
                        : row.level === "low"
                          ? t("reporting.lowStock")
                          : t("reporting.nearExpiry");
                  const available = availableQuantity(row.balance);

                  return (
                     <tr key={row.balance.id}>
                        <td>
                           <div className={styles.reportingTablePrimary}>{row.balance.productName}</div>
                           <div className={styles.reportingTableMuted}>{row.balance.batchNumber}</div>
                        </td>
                        <td>
                           <div className={styles.reportingTablePrimary}>{siteName(row.balance.siteId)}</div>
                           <div className={styles.reportingTableMuted}>
                              {locationName(row.balance.storageLocationId)}
                           </div>
                        </td>
                        <td>
                           <div className={styles.reportingTablePrimary}>{formatQuantity(available)}</div>
                           <div className={styles.reportingTableMuted}>
                              {t("reporting.stockPosition", {
                                 onHand: formatQuantity(row.balance.quantityOnHand),
                                 reserved: formatQuantity(row.balance.quantityReserved),
                              })}
                           </div>
                        </td>
                        <td>{new Date(row.balance.expiryDate).toLocaleDateString()}</td>
                        <td>
                           <Badge variant={row.level === "both" ? "destructive" : "outline"}>{riskLabel}</Badge>
                        </td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}

export default function ReportingPage() {
   const t = useT();
   const authUser = useAuth();
   const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [activityTab, setActivityTab] = useState<"action" | "entity">("action");

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData() {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [summaryData, balanceData, siteData, storageLocationData] = await Promise.all([
            loadDashboardSummary(),
            loadInventoryBalances(),
            loadSites(),
            loadStorageLocations(),
         ]);
         setSummary(summaryData);
         setBalances(balanceData);
         setSites(siteData);
         setStorageLocations(storageLocationData);
         setLastLoadedAt(new Date());
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("reporting.loadError"));
      } finally {
         setIsLoading(false);
      }
   }

   const recentActivity = useMemo(() => summary?.recentActivity ?? [], [summary]);
   const actionSummaries = useMemo(
      () => countBy(recentActivity, (entry) => t(`audit.action.${entry.action}`)).slice(0, 6),
      [recentActivity, t],
   );
   const entitySummaries = useMemo(
      () => countBy(recentActivity, (entry) => t(`audit.entity.${entry.entityType}`)).slice(0, 6),
      [recentActivity, t],
   );
   const totalBatches = balances.length;
   const lowStockCount = balances.filter(isLowStock).length;
   const nearExpiryCount = balances.filter(isNearExpiry).length;
   const totalOnHand = balances.reduce((total, balance) => total + balance.quantityOnHand, 0);
   const totalReserved = balances.reduce((total, balance) => total + balance.quantityReserved, 0);
   const metric = (value: number | undefined) => (isLoading || summary === null ? "..." : formatQuantity(value ?? 0));

   const canOpenInventory = authUser !== null && canAccessPath(authUser, "/dashboard/inventory");
   const canOpenAudit = authUser !== null && canAccessPath(authUser, "/dashboard/audit");

   return (
      <AppShell
         active="reporting"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.reporting") }]} />
         }
      >
         <div className={styles.reportingPage}>
            <PageHeader
               title={t("reporting.title")}
               description={t("reporting.description")}
               actions={
                  <div className="page-actions">
                     {canOpenInventory ? (
                        <a className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground" href="/dashboard/inventory">
                           {t("reporting.openInventory")}
                        </a>
                     ) : null}
                     {canOpenAudit ? (
                        <a className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground" href="/dashboard/audit">
                           {t("reporting.openAudit")}
                        </a>
                     ) : null}
                     <Button variant="outline" onClick={() => void refreshData()}>
                        {t("common.refresh")}
                     </Button>
                  </div>
               }
            />

            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <ReportingSourceStrip lastLoadedAt={lastLoadedAt} />

            {isLoading ? (
               <section
                  className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.dashboardSection}`}
               >
                  <div className="p-4">
                     <EmptyState icon="…" title={t("reporting.loading")} description={t("reporting.fetching")} />
                  </div>
               </section>
            ) : summary === null ? (
               <section
                  className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.dashboardSection}`}
               >
                  <div className="p-4">
                     <EmptyState icon="0" title={t("reporting.emptyTitle")} description={t("reporting.emptyDesc")} />
                  </div>
               </section>
            ) : (
               <>
                  <ReportingSection title={t("reporting.kpiTitle")} description={t("reporting.kpiDesc")}>
                     <div className={`${styles.statRow} ${styles.dashboardStatRow} ${styles.reportingKpiRow}`}>
                        <ReportingStat label={t("dashboard.totalSites")} value={metric(summary.totalSites)} />
                        <ReportingStat label={t("dashboard.totalProducts")} value={metric(summary.totalProducts)} />
                        <ReportingStat
                           label={t("dashboard.quantityOnHand")}
                           value={metric(summary.totalQuantityOnHand)}
                        />
                        <ReportingStat
                           label={t("dashboard.quantityReserved")}
                           value={metric(summary.totalQuantityReserved)}
                        />
                        <ReportingStat
                           label={t("dashboard.pendingTransfers")}
                           value={metric(summary.pendingTransferCount)}
                        />
                        <ReportingStat
                           label={t("dashboard.openPrescriptions")}
                           value={metric(summary.openPrescriptionCount)}
                        />
                     </div>
                  </ReportingSection>

                  <ReportingSection title={t("reporting.inventoryTitle")} description={t("reporting.inventoryDesc")}>
                     <div className={`${styles.statRow} ${styles.dashboardStatRow} ${styles.reportingRiskSummary}`}>
                        <ReportingStat label={t("reporting.totalBatches")} value={formatQuantity(totalBatches)} />
                        <ReportingStat label={t("reporting.liveOnHand")} value={formatQuantity(totalOnHand)} />
                        <ReportingStat label={t("reporting.liveReserved")} value={formatQuantity(totalReserved)} />
                        <ReportingStat label={t("reporting.lowStockBatches")} value={formatQuantity(lowStockCount)} />
                        <ReportingStat
                           label={t("reporting.nearExpiryBatches")}
                           value={formatQuantity(nearExpiryCount)}
                        />
                     </div>
                     <div className={styles.reportingSectionBlock}>
                        <InventoryRiskTable balances={balances} sites={sites} storageLocations={storageLocations} />
                     </div>
                  </ReportingSection>

                  <section
                     className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.dashboardSection}`}
                  >
                     <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                           <div>
                              <h2 className="m-0 text-sm font-semibold text-foreground">
                                 {t("reporting.activityByAction")}
                              </h2>
                              <p className="mt-1 text-sm text-muted-foreground">
                                 {t("reporting.activityByActionDesc")}
                              </p>
                           </div>
                        </div>
                        <div className={styles.reportingTabStrip}>
                           <button
                              type="button"
                              className={`${styles.reportingTab} ${activityTab === "action" ? styles.reportingTabActive : ""}`}
                              onClick={() => setActivityTab("action")}
                           >
                              {t("reporting.activityByAction")}
                           </button>
                           <button
                              type="button"
                              className={`${styles.reportingTab} ${activityTab === "entity" ? styles.reportingTabActive : ""}`}
                              onClick={() => setActivityTab("entity")}
                           >
                              {t("reporting.activityByEntity")}
                           </button>
                        </div>
                        <div className={styles.reportingTabPanel}>
                           {activityTab === "action" ? (
                              <CountList
                                 items={actionSummaries}
                                 emptyTitle={t("reporting.noActivityTitle")}
                                 emptyDescription={t("reporting.noActivityDesc")}
                              />
                           ) : (
                              <CountList
                                 items={entitySummaries}
                                 emptyTitle={t("reporting.noActivityTitle")}
                                 emptyDescription={t("reporting.noActivityDesc")}
                              />
                           )}
                        </div>
                     </div>
                  </section>

                  <ReportingSection
                     title={t("reporting.recentActivity")}
                     description={t("reporting.recentActivityDesc")}
                  >
                     <RecentAuditList logs={recentActivity} sites={sites} />
                  </ReportingSection>
               </>
            )}
         </div>
      </AppShell>
   );
}
