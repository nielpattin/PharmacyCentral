import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { EmptyState } from "../components/ui/EmptyState";
import {
   loadAuditLogs,
   loadSites,
   type AuditLogEntryDto,
   type AuditLogFilters,
   type SiteDto,
} from "../api/pharmacyClient";
import { AuditLogTable } from "../features/audit/AuditLogTable";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import styles from "./AuditPage.module.css";
import { formatAuditSummary } from "../lib/auditDisplay";

const AUDIT_ACTIONS = [
   "Created",
   "Updated",
   "Deleted",
   "Posted",
   "Approved",
   "Shipped",
   "Received",
   "Dispensed",
   "Cancelled",
];
const AUDIT_ENTITY_TYPES = [
   "Site",
   "StorageLocation",
   "Product",
   "Supplier",
   "GoodsReceipt",
   "TransferOrder",
   "Prescription",
   "StocktakeSession",
   "StockAdjustment",
   "StockLedgerEntry",
];

const defaultFilters = {
   userId: "",
   siteId: "",
   entityType: "",
   entityId: "",
   action: "",
   limit: 100,
};

type AuditLogFilterValues = typeof defaultFilters;

function isUuidLike(value: string) {
   return value === "" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toAuditLogFilters(values: AuditLogFilterValues): AuditLogFilters {
   return {
      userId: values.userId.trim(),
      siteId: values.siteId,
      entityType: values.entityType,
      entityId: values.entityId.trim(),
      action: values.action,
      limit: values.limit,
   };
}

function auditActionTone(action: string) {
   if (action === "Deleted" || action === "Cancelled") return "destructive";
   if (action === "Updated") return "outline";
   return "secondary";
}

function formatDetails(details: string | null) {
   if (details === null || details.trim() === "") {
      return "";
   }

   try {
      return JSON.stringify(JSON.parse(details), null, 2);
   } catch {
      return details;
   }
}

function shortId(id: string | null) {
   return id === null ? "" : id.slice(0, 8);
}

export default function AuditPage() {
   const t = useT();
   const [logs, setLogs] = useState<AuditLogEntryDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [filters, setFilters] = useState<AuditLogFilterValues>(defaultFilters);
   const [selectedId, setSelectedId] = useState("");
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);

   const selectedLog = useMemo(() => logs.find((log) => log.id === selectedId) ?? null, [logs, selectedId]);
   const details = formatDetails(selectedLog?.details ?? null);
   const siteName = (siteId: string | null) =>
      siteId === null ? t("audit.system") : (sites.find((site) => site.id === siteId)?.name ?? siteId);

   useMountEffect(() => {
      void refreshData(defaultFilters);
   });

   async function refreshData(nextFilters = filters) {
      if (!isUuidLike(nextFilters.userId.trim()) || !isUuidLike(nextFilters.entityId.trim())) {
         setBannerError(t("audit.invalidGuid"));
         return;
      }

      setIsLoading(true);
      setBannerError(null);
      try {
         const [logData, siteData] = await Promise.all([loadAuditLogs(toAuditLogFilters(nextFilters)), loadSites()]);
         setLogs(logData);
         setSites(siteData);
         setSelectedId(logData.some((log) => log.id === selectedId) ? selectedId : (logData[0]?.id ?? ""));
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadAuditLogs"));
      } finally {
         setIsLoading(false);
      }
   }

   function updateFilter<K extends keyof AuditLogFilterValues>(key: K, value: AuditLogFilterValues[K]) {
      setFilters((current) => ({ ...current, [key]: value }));
   }

   function handleApplyFilters() {
      void refreshData(filters);
   }

   function handleClearFilters() {
      setFilters(defaultFilters);
      void refreshData(defaultFilters);
   }

   return (
      <AppShell
         active="audit"
         breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.audit") }]} />}
      >
         <div className={styles.sitesPage}>
            <PageHeader
               title={t("audit.title")}
               description={t("audit.description")}
               actions={
                  <div className="page-actions">
                     <Button variant="outline" onClick={() => void refreshData()}>
                        {t("common.refresh")}
                     </Button>
                  </div>
               }
            />

            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}

            <div className={`${styles.siteWorkbench} ${styles.auditWorkbench}`}>
               <section
                  className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.siteRegistry}`}
               >
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("audit.registry")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("audit.registryDesc")}</p>
                        </div>
                        <Badge variant="outline">
                           {isLoading ? t("audit.loadingState") : `${logs.length} ${t("common.records")}`}
                        </Badge>
                     </div>

                     <div className={styles.auditFilterGrid}>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={filters.siteId}
                           onChange={(event) => updateFilter("siteId", event.target.value)}
                        >
                           <option value="">{t("audit.allSites")}</option>
                           {sites.map((site) => (
                              <option key={site.id} value={site.id}>
                                 {site.name}
                              </option>
                           ))}
                        </select>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={filters.action}
                           onChange={(event) => updateFilter("action", event.target.value)}
                        >
                           <option value="">{t("audit.allActions")}</option>
                           {AUDIT_ACTIONS.map((action) => (
                              <option key={action} value={action}>
                                 {t(`audit.action.${action}`)}
                              </option>
                           ))}
                        </select>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={filters.entityType}
                           onChange={(event) => updateFilter("entityType", event.target.value)}
                        >
                           <option value="">{t("audit.allEntityTypes")}</option>
                           {AUDIT_ENTITY_TYPES.map((entityType) => (
                              <option key={entityType} value={entityType}>
                                 {t(`audit.entity.${entityType}`)}
                              </option>
                           ))}
                        </select>
                        <input
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={filters.userId}
                           placeholder={t("audit.userId")}
                           onChange={(event) => updateFilter("userId", event.target.value)}
                        />
                        <input
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={filters.entityId}
                           placeholder={t("audit.entityId")}
                           onChange={(event) => updateFilter("entityId", event.target.value)}
                        />
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={filters.limit}
                           onChange={(event) => updateFilter("limit", Number(event.target.value))}
                        >
                           {[25, 50, 100, 250].map((limit) => (
                              <option key={limit} value={limit}>
                                 {limit}
                              </option>
                           ))}
                        </select>
                     </div>

                     <div className={`flex flex-wrap items-center gap-2 ${styles.auditFilterActions}`}>
                        <Button onClick={handleApplyFilters}>{t("audit.applyFilters")}</Button>
                        <Button variant="outline" onClick={handleClearFilters}>
                           {t("audit.clearFilters")}
                        </Button>
                     </div>

                     {isLoading ? (
                        <EmptyState icon="…" title={t("audit.loading")} description={t("audit.fetching")} />
                     ) : logs.length === 0 ? (
                        <EmptyState icon="0" title={t("audit.emptyTitle")} description={t("audit.emptyDesc")} />
                     ) : (
                        <AuditLogTable rows={logs} selectedId={selectedId} sites={sites} onSelect={setSelectedId} />
                     )}
                  </div>
               </section>

               <aside
                  className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.siteEditor}`}
               >
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("audit.logDetails")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("audit.logDetailsDesc")}</p>
                        </div>
                     </div>

                     {selectedLog === null ? (
                        <EmptyState icon="0" title={t("audit.emptyTitle")} description={t("audit.emptyDesc")} />
                     ) : (
                        <div className={`grid gap-3 ${styles.auditDetailGrid}`}>
                           <div className="flex items-start justify-between gap-3">
                              <div>
                                 <h3 className="m-0 text-sm font-semibold text-foreground">
                                    {formatAuditSummary(
                                       t,
                                       selectedLog.summary,
                                       selectedLog.entityId ?? t("common.noData"),
                                    )}
                                 </h3>
                                 <p className="mt-1 text-sm text-muted-foreground">
                                    {new Date(selectedLog.occurredAtUtc).toLocaleString()}
                                 </p>
                              </div>
                              <Badge variant={auditActionTone(selectedLog.action)}>
                                 {t(`audit.action.${selectedLog.action}`)}
                              </Badge>
                           </div>
                           <dl className={styles.auditDetailList}>
                              <div>
                                 <dt>{t("audit.entityType")}</dt>
                                 <dd>{t(`audit.entity.${selectedLog.entityType}`)}</dd>
                              </div>
                              <div>
                                 <dt>{t("audit.entityId")}</dt>
                                 <dd title={selectedLog.entityId ?? undefined}>
                                    {selectedLog.entityId ?? t("common.noData")}
                                 </dd>
                              </div>
                              <div>
                                 <dt>{t("audit.site")}</dt>
                                 <dd>{siteName(selectedLog.siteId)}</dd>
                              </div>
                              <div>
                                 <dt>{t("audit.userId")}</dt>
                                 <dd title={selectedLog.userId ?? undefined}>
                                    {selectedLog.userId === null ? t("audit.system") : shortId(selectedLog.userId)}
                                 </dd>
                              </div>
                           </dl>
                           <div>
                              <h3 className="m-0 text-sm font-semibold text-foreground">{t("audit.details")}</h3>
                              {details === "" ? (
                                 <p className="mt-1 text-sm text-muted-foreground">{t("common.noData")}</p>
                              ) : (
                                 <pre className={styles.auditDetailsPre}>{details}</pre>
                              )}
                           </div>
                        </div>
                     )}
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
