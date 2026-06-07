import { useState, type ReactNode } from "react";
import { motion, MotionConfig, AnimatePresence } from "motion/react";
import {
   BarChart, Bar, XAxis, YAxis, Tooltip,
   ResponsiveContainer,
} from "recharts";
import {
   AlertTriangle, Clock, Truck, Pill, ClipboardList, SlidersHorizontal,
   Building2, ChevronRight, Package, Tags, DollarSign, ArrowUpRight,
} from "lucide-react";
import styles from "./DashboardPage.module.css";
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
import { formatAuditSummary } from "../lib/auditDisplay";

/* ─── helpers ─── */

const CHART_COLORS = {
   ok: "#5277ff",
   muted: "#a1a1a9",
   bad: "#d74542",
   warn: "#b59412",
};

function auditActionTone(action: string) {
   if (action === "Deleted" || action === "Cancelled") return "bad";
   if (action === "Updated") return "warn";
   return "ok";
}

function computeHealth(summary: DashboardSummaryDto | null) {
   if (summary === null) {
      return { status: "healthy" as const, attentionTotal: 0, serviceWork: 0, stockRisk: 0 };
   }

   const attentionTotal =
      summary.lowStockBatchCount +
      summary.expiringBatchCount +
      summary.pendingTransferCount +
      summary.openPrescriptionCount +
      summary.openStocktakeCount +
      summary.pendingAdjustmentCount;

   const serviceWork =
      summary.openPrescriptionCount +
      summary.pendingTransferCount +
      summary.openStocktakeCount;

   const stockRisk =
      summary.lowStockBatchCount +
      summary.expiringBatchCount;

   const status =
      (stockRisk > 0 && attentionTotal >= 6) ||
      (summary.pendingAdjustmentCount > 0 && attentionTotal >= 6)
         ? "critical"
         : attentionTotal > 0
           ? "needsAttention"
           : "healthy";

   return { status, attentionTotal, serviceWork, stockRisk };
}

/* ─── card wrapper with motion ─── */

function DashCard({
   title,
   description,
   children,
   index = 0,
}: {
   title: string;
   description: string;
   children: ReactNode;
   index?: number;
}) {
   return (
      <motion.div
         className={styles.dashCard}
         initial={{ opacity: 0, y: 12 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ duration: 0.18, delay: index * 0.04, ease: [0.2, 0, 0, 1] }}
      >
         <div className={styles.dashCardHeader}>
            <h2 className={styles.dashCardTitle}>{title}</h2>
            <p className={styles.dashCardSubtitle}>{description}</p>
         </div>
         <div className={styles.dashCardBody}>{children}</div>
      </motion.div>
   );
}

/* ─── skele ─── */

function SkeletonBlock({ height = 80 }: { height?: number }) {
   return (
      <div
         className={styles.dashSkeleton}
         style={{ height, width: "100%", marginBottom: 6 }}
      />
   );
}

/* ─── Operational health band ─── */

function OperationalHealthBand({
   summary,
   isLoading,
}: {
   summary: DashboardSummaryDto | null;
   isLoading: boolean;
}) {
   const t = useT();
   const { status, attentionTotal, serviceWork, stockRisk } = computeHealth(summary);

   const statusLabel = t(
      status === "healthy"
         ? "dashboard.opsStatus.healthy"
         : status === "needsAttention"
           ? "dashboard.opsStatus.needsAttention"
           : "dashboard.opsStatus.critical",
   );

   return (
      <motion.div
         className={styles.opsHealthBand}
         initial={{ opacity: 0, y: 8 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      >
         <div className={styles.opsHealthInner}>
            <div className={styles.opsStatusRow}>
               <div className={styles.opsStatusIndicator}>
                  <motion.span
                     className={`${styles.opsStatusDot} ${styles[status]}`}
                     initial={{ scale: 0 }}
                     animate={{ scale: 1 }}
                     transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  />
                  <span className={styles.opsStatusLabel}>
                     {isLoading || summary === null ? "..." : statusLabel}
                  </span>
               </div>
               <span className={styles.opsStatusCount}>
                  {isLoading || summary === null ? "" : t("dashboard.attentionCount", { count: attentionTotal })}
               </span>
            </div>

            <motion.div
               className={styles.opsFactRow}
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               transition={{ duration: 0.18, delay: 0.06 }}
            >
               <div className={styles.opsFact}>
                  <span className={styles.opsFactLabel}>{t("dashboard.attentionItems")}</span>
                  <strong className={`${styles.opsFactValue} ${attentionTotal > 0 ? styles.warnColor : styles.goodColor}`}>
                     {isLoading || summary === null ? "..." : attentionTotal}
                  </strong>
               </div>
               <div className={styles.opsFact}>
                  <span className={styles.opsFactLabel}>{t("dashboard.serviceWork")}</span>
                  <strong className={`${styles.opsFactValue} ${serviceWork > 0 ? styles.warnColor : styles.goodColor}`}>
                     {isLoading || summary === null ? "..." : serviceWork}
                  </strong>
               </div>
               <div className={styles.opsFact}>
                  <span className={styles.opsFactLabel}>{t("dashboard.stockRisk")}</span>
                  <strong className={`${styles.opsFactValue} ${stockRisk > 0 ? styles.badColor : styles.goodColor}`}>
                     {isLoading || summary === null ? "..." : stockRisk}
                  </strong>
               </div>
            </motion.div>
         </div>
      </motion.div>
   );
}

/* ─── Priority queue ─── */

type QueueItem = {
   key: string;
   label: string;
   hint: string;
   count: number;
   severity: "bad" | "warn" | "ok";
   icon: ReactNode;
   href: string;
};

function PriorityQueue({
   summary,
   isLoading,
}: {
   summary: DashboardSummaryDto | null;
   isLoading: boolean;
}) {
   const t = useT();

   const items: QueueItem[] = [
      {
         key: "lowStock",
         label: t("dashboard.lowStockBatches"),
         hint: "",
         count: summary?.lowStockBatchCount ?? 0,
         severity: "bad",
         icon: <AlertTriangle />,
         href: "/dashboard/reporting",
      },
      {
         key: "expiring",
         label: t("dashboard.expiringBatches"),
         hint: t("dashboard.expiringHint"),
         count: summary?.expiringBatchCount ?? 0,
         severity: "bad",
         icon: <Clock />,
         href: "/dashboard/reporting",
      },
      {
         key: "transfers",
         label: t("dashboard.pendingTransfers"),
         hint: t("dashboard.transfersHint"),
         count: summary?.pendingTransferCount ?? 0,
         severity: "warn",
         icon: <Truck />,
         href: "/dashboard/transfers",
      },
      {
         key: "prescriptions",
         label: t("dashboard.openPrescriptions"),
         hint: t("dashboard.prescriptionsHint"),
         count: summary?.openPrescriptionCount ?? 0,
         severity: "warn",
         icon: <Pill />,
         href: "/dashboard/prescriptions",
      },
      {
         key: "stocktakes",
         label: t("dashboard.openStocktakes"),
         hint: t("dashboard.stocktakesHint"),
         count: summary?.openStocktakeCount ?? 0,
         severity: "ok",
         icon: <ClipboardList />,
         href: "/dashboard/stocktake",
      },
      {
         key: "adjustments",
         label: t("dashboard.pendingAdjustments"),
         hint: t("dashboard.adjustmentsHint"),
         count: summary?.pendingAdjustmentCount ?? 0,
         severity: "ok",
         icon: <SlidersHorizontal />,
         href: "/dashboard/adjustments",
      },
   ];

   if (isLoading || summary === null) {
      return (
         <div className={styles.dashCardBody}>
            {Array.from({ length: 4 }).map((_, i) => (
               <SkeletonBlock key={i} height={48} />
            ))}
         </div>
      );
   }

   const totalAttention = items.reduce((acc, item) => acc + item.count, 0);

   if (totalAttention === 0) {
      return (
         <div className={styles.dashCardBody}>
            <EmptyState
               icon="0"
               title={t("dashboard.healthy")}
               description={t("dashboard.noIssues")}
            />
         </div>
      );
   }

   return (
      <div className={styles.priorityQueue}>
         <AnimatePresence mode="popLayout">
            {items
               .filter((item) => item.count > 0)
               .map((item, i) => (
                  <motion.a
                     key={item.key}
                     href={item.href}
                     className={styles.priorityItem}
                     layout
                     initial={{ opacity: 0, x: -8 }}
                     animate={{ opacity: 1, x: 0 }}
                     exit={{ opacity: 0, x: -8 }}
                     transition={{ duration: 0.16, delay: i * 0.03, ease: [0.2, 0, 0, 1] }}
                     whileTap={{ scale: 0.98 }}
                  >
                     <span className={`${styles.priorityIcon} ${styles[item.severity]}`}>
                        {item.icon}
                     </span>
                     <div className={styles.priorityLabelCol}>
                        <span className={styles.priorityLabel}>{item.label}</span>
                        <span className={styles.priorityHint}>{item.hint}</span>
                     </div>
                     <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        <span className={`${styles.priorityCount} ${styles[item.severity]}`}>
                           {item.count}
                        </span>
                        <ChevronRight
                           size={14}
                           style={{ color: "var(--muted-soft)", flexShrink: 0 }}
                        />
                     </div>
                  </motion.a>
               ))}
         </AnimatePresence>
      </div>
   );
}

/* ─── Attention breakdown bars ─── */

type AttnItem = { key: string; label: string; count: number; severity: "bad" | "warn" | "ok" };

function AttentionBreakdown({
   summary,
   isLoading,
}: {
   summary: DashboardSummaryDto | null;
   isLoading: boolean;
}) {
   const t = useT();

   const items: AttnItem[] = [
      { key: "lowStock", label: t("dashboard.lowStockBatches"), count: summary?.lowStockBatchCount ?? 0, severity: "bad" },
      { key: "expiring", label: t("dashboard.expiringBatches"), count: summary?.expiringBatchCount ?? 0, severity: "bad" },
      { key: "transfers", label: t("dashboard.pendingTransfers"), count: summary?.pendingTransferCount ?? 0, severity: "warn" },
      { key: "prescriptions", label: t("dashboard.openPrescriptions"), count: summary?.openPrescriptionCount ?? 0, severity: "warn" },
      { key: "stocktakes", label: t("dashboard.openStocktakes"), count: summary?.openStocktakeCount ?? 0, severity: "ok" },
      { key: "adjustments", label: t("dashboard.pendingAdjustments"), count: summary?.pendingAdjustmentCount ?? 0, severity: "ok" },
   ];

   const maxCount = Math.max(...items.map((i) => i.count), 1);

   if (isLoading || summary === null) {
      return <SkeletonBlock height={140} />;
   }

   const total = items.reduce((s, i) => s + i.count, 0);
   if (total === 0) {
      return (
         <EmptyState
            icon="0"
            title={t("dashboard.healthy")}
            description={t("dashboard.noIssues")}
         />
      );
   }

   return (
      <div className={styles.attentionBars}>
         <AnimatePresence>
            {items
               .filter((i) => i.count > 0)
               .map((item, idx) => {
                  const pct = Math.round((item.count / maxCount) * 100);
                  return (
                     <motion.div
                        key={item.key}
                        className={styles.attentionBarRow}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.14, delay: idx * 0.03, ease: [0.2, 0, 0, 1] }}
                     >
                        <div className={styles.attentionBarHeader}>
                           <span className={styles.attentionBarLabel}>{item.label}</span>
                           <span className={styles.attentionBarCount}>{item.count}</span>
                        </div>
                        <div className={styles.attentionBarTrack}>
                           <motion.div
                              className={`${styles.attentionBarFill} ${styles[item.severity]}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.max(pct, 6)}%` }}
                              transition={{ duration: 0.25, delay: idx * 0.04, ease: [0.2, 0, 0, 1] }}
                           />
                        </div>
                     </motion.div>
                  );
               })}
         </AnimatePresence>
      </div>
   );
}

/* ─── Inventory position chart ─── */

function InventoryPositionChart({
   summary,
   isLoading,
}: {
   summary: DashboardSummaryDto | null;
   isLoading: boolean;
}) {
   const t = useT();
   const available = Math.max((summary?.totalQuantityOnHand ?? 0) - (summary?.totalQuantityReserved ?? 0), 0);
   const data = [
      { name: t("dashboard.barAvailable"), value: available, fill: CHART_COLORS.ok },
      { name: t("dashboard.barReserved"), value: summary?.totalQuantityReserved ?? 0, fill: CHART_COLORS.muted },
   ];

   if (isLoading || summary === null) {
      return <SkeletonBlock height={120} />;
   }

   return (
      <div className={styles.inventoryChartWrap} style={{ height: 120 }}>
         <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
               <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: CHART_COLORS.muted, fontWeight: 600 }}
               />
               <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: CHART_COLORS.muted, fontWeight: 600 }}
               />
               <Tooltip
                  contentStyle={{
                     background: "#fff",
                     border: "1px solid #e2e3e8",
                     borderRadius: 6,
                     fontSize: "0.813rem",
                     boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
               />
               <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {data.map((entry, i) => (
                     <rect key={i} fill={entry.fill} />
                  ))}
               </Bar>
            </BarChart>
         </ResponsiveContainer>
      </div>
   );
}

/* ─── Workload chart (for Flow tab) ─── */

function WorkloadChart({
   summary,
   isLoading,
}: {
   summary: DashboardSummaryDto | null;
   isLoading: boolean;
}) {
   const t = useT();

   const data = [
      { name: t("dashboard.openPrescriptions"), value: summary?.openPrescriptionCount ?? 0, fill: CHART_COLORS.warn },
      { name: t("dashboard.pendingTransfers"), value: summary?.pendingTransferCount ?? 0, fill: CHART_COLORS.warn },
      { name: t("dashboard.openStocktakes"), value: summary?.openStocktakeCount ?? 0, fill: CHART_COLORS.ok },
      { name: t("dashboard.pendingAdjustments"), value: summary?.pendingAdjustmentCount ?? 0, fill: CHART_COLORS.ok },
   ];

   if (isLoading || summary === null) {
      return <SkeletonBlock height={180} />;
   }

   const total = data.reduce((s, i) => s + i.value, 0);
   if (total === 0) {
      return (
         <EmptyState
            icon="0"
            title={t("dashboard.healthy")}
            description={t("dashboard.noIssues")}
         />
      );
   }

   return (
      <div className={styles.flowChartWrap} style={{ height: 180 }}>
         <ResponsiveContainer width="100%" height="100%">
            <BarChart
               data={data}
               layout="vertical"
               margin={{ top: 4, right: 8, bottom: 4, left: 4 }}
            >
               <XAxis type="number" axisLine={false} tickLine={false}
                  tick={{ fontSize: 11, fill: CHART_COLORS.muted, fontWeight: 600 }} />
               <YAxis type="category" dataKey="name" axisLine={false} tickLine={false}
                  tick={{ fontSize: 11, fill: CHART_COLORS.muted, fontWeight: 600 }} width={100} />
               <Tooltip
                  contentStyle={{
                     background: "#fff",
                     border: "1px solid #e2e3e8",
                     borderRadius: 6,
                     fontSize: "0.813rem",
                     boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
               />
               <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {data.filter((d) => d.value > 0).map((entry, i) => (
                     <rect key={i} fill={entry.fill} />
                  ))}
               </Bar>
            </BarChart>
         </ResponsiveContainer>
      </div>
   );
}

/* ─── Network coverage panel ─── */

function NetworkCoveragePanel({
   summary,
   isLoading,
   metric,
}: {
   summary: DashboardSummaryDto | null;
   isLoading: boolean;
   metric: (value: number | undefined) => string | number;
}) {
   const t = useT();

   if (isLoading || summary === null) {
      return (
         <div className={styles.dashCardBody}>
            <SkeletonBlock height={40} />
            <SkeletonBlock height={40} />
            <SkeletonBlock height={36} />
         </div>
      );
   }

   const sitePct = summary.totalSites > 0
      ? Math.round((summary.activeSites / summary.totalSites) * 100)
      : 0;
   const locPct = summary.totalStorageLocations > 0
      ? Math.round((summary.activeStorageLocations / summary.totalStorageLocations) * 100)
      : 0;

   return (
      <div className={styles.networkPanel} style={{ gap: 8 }}>
         <div className={styles.networkRow}>
            <div className={styles.networkRowHeader}>
               <span className={styles.networkRowLabel}>{t("dashboard.activeSitesLabel")}</span>
               <span className={styles.networkRowCount}>
                  {metric(summary.activeSites)} / {metric(summary.totalSites)}
               </span>
            </div>
            <div className={styles.networkBar}>
               <motion.div
                  className={styles.networkBarFill}
                  initial={{ width: 0 }}
                  animate={{ width: `${sitePct}%` }}
                  transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
               />
            </div>
         </div>
         <div className={styles.networkRow}>
            <div className={styles.networkRowHeader}>
               <span className={styles.networkRowLabel}>{t("dashboard.activeLocationsLabel")}</span>
               <span className={styles.networkRowCount}>
                  {metric(summary.activeStorageLocations)} / {metric(summary.totalStorageLocations)}
               </span>
            </div>
            <div className={styles.networkBar}>
               <motion.div
                  className={styles.networkBarFill}
                  initial={{ width: 0 }}
                  animate={{ width: `${locPct}%` }}
                  transition={{ duration: 0.3, ease: [0.2, 0, 0, 1], delay: 0.06 }}
               />
            </div>
         </div>
         <div className={styles.networkSecondary} style={{ paddingTop: 6, marginTop: 6 }}>
            <div className={styles.networkSecondaryItem}>
               <span className={styles.networkSecondaryLabel}>{t("dashboard.totalProducts")}</span>
               <span className={styles.networkSecondaryValue}>
                  {metric(summary.totalProducts)}
               </span>
            </div>
            <div className={styles.networkSecondaryItem}>
               <span className={styles.networkSecondaryLabel}>{t("dashboard.totalSuppliers")}</span>
               <span className={styles.networkSecondaryValue}>
                  {metric(summary.totalSuppliers)}
               </span>
            </div>
         </div>
      </div>
   );
}

/* ─── Activity feed ─── */

function DashboardActivityFeed({
   activity,
   sites,
   isLoading,
   summary,
}: {
   activity: DashboardActivityDto[];
   sites: SiteDto[];
   isLoading: boolean;
   summary: DashboardSummaryDto | null;
}) {
   const t = useT();
   const authUser = useAuth();
   const siteName = (siteId: string | null) =>
      siteId === null ? t("audit.system") : (sites.find((site) => site.id === siteId)?.name ?? siteId);

   if (isLoading || summary === null) {
      return (
         <div className={styles.dashCardBody}>
            {Array.from({ length: 3 }).map((_, i) => (
               <SkeletonBlock key={i} height={48} />
            ))}
         </div>
      );
   }

   if (activity.length === 0) {
      return (
         <div className={styles.dashCardBody}>
            <div className={styles.activityFeedEmpty}>
               <span className={styles.activityFeedEmptyText}>
                  {t("dashboard.activityCompactEmpty")}
               </span>
               {authUser?.isPlatformAdmin ? (
                  <a className="btn secondary btn-sm" href="/dashboard/audit">
                     {t("dashboard.openAudit")}
                  </a>
               ) : null}
            </div>
         </div>
      );
   }

   return (
      <div className={styles.activityFeed}>
         <AnimatePresence mode="popLayout">
            {activity.slice(0, 3).map((entry, i) => (
               <motion.article
                  key={entry.id}
                  className={styles.activityFeedItem}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.12, delay: i * 0.02, ease: [0.2, 0, 0, 1] }}
               >
                  <div className={styles.activityFeedTop}>
                     <Badge tone={auditActionTone(entry.action)}>
                        {t(`audit.action.${entry.action}`)}
                     </Badge>
                     <span style={{ fontWeight: 700, fontSize: "0.813rem" }}>
                        {t(`audit.entity.${entry.entityType}`)}
                     </span>
                  </div>
                  <p className={styles.activityFeedSummary}>
                     {formatAuditSummary(t, entry.summary, entry.entityId ?? t("common.noData"))}
                  </p>
                  <div className={styles.activityFeedMeta}>
                     <span>{siteName(entry.siteId)}</span>
                     <span>·</span>
                     <time>{new Date(entry.occurredAtUtc).toLocaleString()}</time>
                  </div>
               </motion.article>
            ))}
         </AnimatePresence>
      </div>
   );
}


/* ─── Today work mix compact chart ─── */

function TodayWorkMix({
   summary,
   isLoading,
}: {
   summary: DashboardSummaryDto | null;
   isLoading: boolean;
}) {
   const t = useT();

   const items: { key: string; label: string; count: number; severity: "bad" | "warn" | "ok" }[] = [
      { key: "lowStock", label: t("dashboard.lowStockBatches"), count: summary?.lowStockBatchCount ?? 0, severity: "bad" },
      { key: "expiring", label: t("dashboard.expiringBatches"), count: summary?.expiringBatchCount ?? 0, severity: "bad" },
      { key: "transfers", label: t("dashboard.pendingTransfers"), count: summary?.pendingTransferCount ?? 0, severity: "warn" },
      { key: "prescriptions", label: t("dashboard.openPrescriptions"), count: summary?.openPrescriptionCount ?? 0, severity: "warn" },
      { key: "stocktakes", label: t("dashboard.openStocktakes"), count: summary?.openStocktakeCount ?? 0, severity: "ok" },
      { key: "adjustments", label: t("dashboard.pendingAdjustments"), count: summary?.pendingAdjustmentCount ?? 0, severity: "ok" },
   ];

   if (isLoading || summary === null) {
      return <SkeletonBlock height={120} />;
   }

   const maxCount = Math.max(...items.map((i) => i.count), 1);
   const total = items.reduce((s, i) => s + i.count, 0);

   if (total === 0) {
      return (
         <EmptyState
            icon="0"
            title={t("dashboard.healthy")}
            description={t("dashboard.noIssues")}
         />
      );
   }

   return (
      <div className={styles.todayWorkMix}>
         {items
            .filter((i) => i.count > 0)
            .map((item) => {
               const pct = Math.round((item.count / maxCount) * 100);
               return (
                  <div key={item.key} className={styles.todayMixRow}>
                     <div className={styles.todayMixHeader}>
                        <span className={styles.todayMixLabel}>{item.label}</span>
                        <span className={styles.todayMixCount}>{item.count}</span>
                     </div>
                     <div className={styles.todayMixTrack}>
                        <div
                           className={`${styles.todayMixFill} ${styles[item.severity]}`}
                           style={{ width: `${Math.max(pct, 4)}%` }}
                        />
                     </div>
                  </div>
               );
            })}
      </div>
   );
}


/* ─── Tab bar ─── */

type TabId = "today" | "stock" | "flow" | "network";

const TAB_IDS: TabId[] = ["today", "stock", "flow", "network"];

const tabKey = (id: TabId) => `dashboard.tab.${id}` as const;

/* ─── Page ─── */

export default function DashboardPage() {
   const t = useT();
   const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [siteFilter, setSiteFilter] = useState("");
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [activeTab, setActiveTab] = useState<TabId>("today");
   const numberFormatter = new Intl.NumberFormat();

   useMountEffect(() => {
      void refreshData("");
   });

   async function refreshData(nextSiteId = siteFilter) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [summaryData, siteData] = await Promise.all([
            loadDashboardSummary({ siteId: nextSiteId }),
            loadSites(),
         ]);
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

   const activity = summary?.recentActivity ?? [];

   return (
      <MotionConfig reducedMotion="user">
         <AppShell
            active="dashboard"
            breadcrumb={
               <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.dashboard") }]} />
            }
         >
            <div className={styles.dashboardPage}>
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

               {bannerError !== null ? (
                  <motion.div
                     className="notice danger-note"
                     initial={{ opacity: 0, y: -8 }}
                     animate={{ opacity: 1, y: 0 }}
                     transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
                  >
                     {bannerError}
                  </motion.div>
               ) : null}

               {/* ─── Always-visible top: health band ─── */}
               <OperationalHealthBand summary={summary} isLoading={isLoading} />

               {/* ─── Tab bar ─── */}
               <nav className={styles.dashTabs} role="tablist">
                  {TAB_IDS.map((id) => (
                     <button
                        key={id}
                        role="tab"
                        aria-selected={activeTab === id}
                        className={`${styles.dashTab}${activeTab === id ? ` ${styles.active}` : ""}`}
                        onClick={() => setActiveTab(id)}
                     >
                        {t(tabKey(id))}
                     </button>
                  ))}
               </nav>

               {/* ─── Tab content ─── */}
               <AnimatePresence mode="wait">
                  <motion.div
                     key={activeTab}
                     className={styles.tabBody}
                     initial={{ opacity: 0, y: 8 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, y: -4 }}
                     transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
                  >
                     {activeTab === "today" &&
                        <div className={styles.todayGrid}>
                           <div className={styles.todayMain}>
                              <DashCard
                                 title={t("dashboard.priorityQueue")}
                                 description={t("dashboard.priorityQueueDesc")}
                                 index={0}
                              >
                                 <PriorityQueue summary={summary} isLoading={isLoading} />
                              </DashCard>
                           </div>
                           <div className={styles.todaySide}>
                              <DashCard
                                 title={t("dashboard.todayWorkMix")}
                                 description={t("dashboard.todayWorkMixDesc")}
                                 index={1}
                              >
                                 <TodayWorkMix summary={summary} isLoading={isLoading} />
                              </DashCard>
                              <DashCard
                                 title={t("dashboard.recentActivity")}
                                 description={t("dashboard.recentActivityDesc")}
                                 index={2}
                              >
                                 <DashboardActivityFeed
                                    activity={activity}
                                    sites={sites}
                                    isLoading={isLoading}
                                    summary={summary}
                                 />
                              </DashCard>
                           </div>
                        </div>}

                     {activeTab === "stock" &&
                        <div className={styles.stockGrid}>
                           <div className={styles.stockMain}>
                              <DashCard
                                 title={t("dashboard.attentionMix")}
                                 description={t("dashboard.attentionMixDesc")}
                                 index={0}
                              >
                                 <AttentionBreakdown summary={summary} isLoading={isLoading} />
                              </DashCard>
                              <DashCard
                                 title={t("dashboard.inventoryPosition")}
                                 description={t("dashboard.inventoryPositionDesc")}
                                 index={1}
                              >
                                 <InventoryPositionChart summary={summary} isLoading={isLoading} />
                              </DashCard>
                           </div>
                           <div className={styles.stockSide}>
                              <DashCard
                                 title={t("dashboard.stockRisk")}
                                 description=""
                                 index={1}
                              >
                                 <div className={styles.stockRiskCards}>
                                    <div className={styles.opsFact}>
                                       <span className={styles.opsFactLabel}>{t("dashboard.lowStockBatches")}</span>
                                       <strong className={`${styles.opsFactValue} ${(summary?.lowStockBatchCount ?? 0) > 0 ? styles.badColor : styles.goodColor}`}>
                                          {metric(summary?.lowStockBatchCount)}
                                       </strong>
                                    </div>
                                    <div className={styles.opsFact}>
                                       <span className={styles.opsFactLabel}>{t("dashboard.expiringBatches")}</span>
                                       <strong className={`${styles.opsFactValue} ${(summary?.expiringBatchCount ?? 0) > 0 ? styles.badColor : styles.goodColor}`}>
                                          {metric(summary?.expiringBatchCount)}
                                       </strong>
                                    </div>
                                 </div>
                              </DashCard>
                              <DashCard
                                 title={t("dashboard.networkCoverage")}
                                 description={t("dashboard.networkCoverageDesc")}
                                 index={2}
                              >
                                 <NetworkCoveragePanel summary={summary} isLoading={isLoading} metric={metric} />
                              </DashCard>
                           </div>
                        </div>}

                     {activeTab === "flow" &&
                        <div className={styles.flowGrid}>
                           <div className={styles.todayMain}>
                              <DashCard
                                 title={t("dashboard.attentionMix")}
                                 description={t("dashboard.attentionMixDesc")}
                                 index={0}
                              >
                                 <WorkloadChart summary={summary} isLoading={isLoading} />
                              </DashCard>
                           </div>
                           <div className={styles.todaySide}>
                              <DashCard
                                 title={t("dashboard.quickActions")}
                                 description={t("dashboard.quickActionsDesc")}
                                 index={1}
                              >
                                 <div className={styles.actionLinkGrid}>
                                    <a href="/dashboard/prescriptions" className={styles.actionLinkItem}>
                                       <span className={styles.actionLinkIcon}><Pill /></span>
                                       {t("dashboard.prescription")}
                                       <ArrowUpRight size={14} style={{ marginLeft: "auto", color: "var(--muted-soft)" }} />
                                    </a>
                                    <a href="/dashboard/transfers" className={styles.actionLinkItem}>
                                       <span className={styles.actionLinkIcon}><Truck /></span>
                                       {t("dashboard.transfer")}
                                       <ArrowUpRight size={14} style={{ marginLeft: "auto", color: "var(--muted-soft)" }} />
                                    </a>
                                    <a href="/dashboard/stocktake" className={styles.actionLinkItem}>
                                       <span className={styles.actionLinkIcon}><ClipboardList /></span>
                                       {t("dashboard.openStocktakes")}
                                       <ArrowUpRight size={14} style={{ marginLeft: "auto", color: "var(--muted-soft)" }} />
                                    </a>
                                    <a href="/dashboard/adjustments" className={styles.actionLinkItem}>
                                       <span className={styles.actionLinkIcon}><SlidersHorizontal /></span>
                                       {t("dashboard.pendingAdjustments")}
                                       <ArrowUpRight size={14} style={{ marginLeft: "auto", color: "var(--muted-soft)" }} />
                                    </a>
                                 </div>
                              </DashCard>
                           </div>
                        </div>}

                     {activeTab === "network" &&
                        <div className={styles.networkGrid}>
                           <div className={styles.todayMain}>
                              <DashCard
                                 title={t("dashboard.networkCoverage")}
                                 description={t("dashboard.networkCoverageDesc")}
                                 index={0}
                              >
                                 <NetworkCoveragePanel summary={summary} isLoading={isLoading} metric={metric} />
                              </DashCard>
                           </div>
                           <div className={styles.todaySide}>
                              <DashCard
                                 title={t("dashboard.quickActions")}
                                 description={t("dashboard.quickActionsDesc")}
                                 index={1}
                              >
                                 <div className={styles.networkLinks}>
                                    <a href="/dashboard/sites" className={styles.actionLinkItem}>
                                       <span className={styles.actionLinkIcon}><Building2 /></span>
                                       {t("dashboard.sites")}
                                       <ArrowUpRight size={14} style={{ marginLeft: "auto", color: "var(--muted-soft)" }} />
                                    </a>
                                    <a href="/dashboard/catalog" className={styles.actionLinkItem}>
                                       <span className={styles.actionLinkIcon}><Package /></span>
                                       {t("nav.catalog")}
                                       <ArrowUpRight size={14} style={{ marginLeft: "auto", color: "var(--muted-soft)" }} />
                                    </a>
                                    <a href="/dashboard/supplier" className={styles.actionLinkItem}>
                                       <span className={styles.actionLinkIcon}><Tags /></span>
                                       {t("nav.supplier")}
                                       <ArrowUpRight size={14} style={{ marginLeft: "auto", color: "var(--muted-soft)" }} />
                                    </a>
                                    <a href="/dashboard/pricing" className={styles.actionLinkItem}>
                                       <span className={styles.actionLinkIcon}><DollarSign /></span>
                                       {t("nav.pricing")}
                                       <ArrowUpRight size={14} style={{ marginLeft: "auto", color: "var(--muted-soft)" }} />
                                    </a>
                                 </div>
                              </DashCard>
                           </div>
                        </div>}
                  </motion.div>
               </AnimatePresence>

               {!isLoading && sites.length === 0 ? (
                  <EmptyState icon="0" title={t("dashboard.noSitesTitle")} description={t("dashboard.noSitesDesc")} />
               ) : null}
            </div>
         </AppShell>
      </MotionConfig>
   );
}
