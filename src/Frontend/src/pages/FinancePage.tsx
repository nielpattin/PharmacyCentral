import { useMemo, useState } from "react";
import { loadFinanceSummary, loadSites, type FinanceSummaryDto, type SiteDto } from "../api/pharmacyClient";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";

function today() {
   return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number) {
   const date = new Date();
   date.setDate(date.getDate() - days);
   return date.toISOString().slice(0, 10);
}

function formatQuantity(value: number) {
   return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number, currency = "VND") {
   return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(value: string | null) {
   return value === null ? "—" : new Date(value).toLocaleString();
}

function formatActivityType(activityType: string, t: (key: string) => string) {
   switch (activityType) {
      case "GoodsReceipt":
         return t("finance.activity.receiving");
      case "Dispense":
      case "Dispensed":
         return t("finance.activity.dispensing");
      case "InventoryReturn":
      case "Return":
      case "InventoryRemoval":
         return t("finance.activity.returns");
      case "ManualAdjustment":
      case "Adjustment":
      case "StocktakeAdjustment":
         return t("finance.activity.adjustments");
      case "TransferOut":
         return t("finance.activity.transferOut");
      case "TransferIn":
         return t("finance.activity.transferIn");
      default:
         return t("finance.activity.other");
   }
}

export default function FinancePage() {
   const t = useT();
   const [summary, setSummary] = useState<FinanceSummaryDto | null>(null);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [siteId, setSiteId] = useState("");
   const [from, setFrom] = useState(daysAgo(30));
   const [to, setTo] = useState(today());
   const [isLoading, setIsLoading] = useState(true);
   const [error, setError] = useState<string | null>(null);

   const sourceLabel = useMemo(() => {
      if (siteId === "") return t("finance.allSites");
      return sites.find((site) => site.id === siteId)?.name ?? siteId;
   }, [siteId, sites, t]);

   useMountEffect(() => { void refresh(); });

   async function refresh() {
      setIsLoading(true);
      setError(null);
      try {
         const [siteData, financeData] = await Promise.all([
            loadSites(),
            loadFinanceSummary({ siteId, from, to }),
         ]);
         setSites(siteData);
         setSummary(financeData);
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : t("finance.errors.load"));
      } finally {
         setIsLoading(false);
      }
   }

   return (
      <AppShell active="finance" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.finance") }]} />}>
         <div className="finance-page">
            <PageHeader title={t("finance.title")} actions={<Button variant="primary" onClick={() => void refresh()}>{t("common.refresh")}</Button>} />
            {error !== null ? <div className="notice danger-note">{error}</div> : null}

            <section className="card">
               <div className="section">
                  <div className="section-header">
                     <div>
                        <h2 className="section-title">{t("finance.filters")}</h2>
                        <p className="section-subtitle">{t("finance.filtersDesc")}</p>
                     </div>
                     <Badge tone="role">{sourceLabel}</Badge>
                  </div>
                  <div className="form-grid finance-filter-grid">
                     <Field label={t("common.site")}>
                        <select className="field-input" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
                           <option value="">{t("finance.allSites")}</option>
                           {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                        </select>
                     </Field>
                     <Field label={t("finance.from")}><input className="field-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
                     <Field label={t("finance.to")}><input className="field-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
                  </div>
               </div>
            </section>

            {isLoading || summary === null ? <EmptyState icon="…" title={t("common.loading")} description={t("finance.loadingDesc")} /> : (
               <>
                  <section className="finance-kpi-grid">
                     <FinanceStat label={t("finance.inventoryValue")} value={formatMoney(summary.inventoryValue)} />
                     <FinanceStat label={t("finance.reservedValue")} value={formatMoney(summary.reservedValue)} />
                     <FinanceStat label={t("finance.quantityOnHand")} value={formatQuantity(summary.totalQuantityOnHand)} />
                     <FinanceStat label={t("finance.missingPrices")} value={String(summary.missingPriceCount)} tone={summary.missingPriceCount > 0 ? "warn" : "ok"} />
                  </section>

                  <div className="finance-grid">
                     <section className="card">
                        <div className="section">
                           <div className="section-header"><div><h2 className="section-title">{t("finance.reconciliation")}</h2><p className="section-subtitle">{t("finance.reconciliationDesc")}</p></div></div>
                           <div className="finance-recon-grid">
                              <FinanceStat label={t("finance.receipts")} value={`${summary.receiptCount} · ${formatQuantity(summary.receiptQuantity)}`} />
                              <FinanceStat label={t("finance.dispensed")} value={formatQuantity(summary.dispensedQuantity)} />
                              <FinanceStat label={t("finance.returns") } value={formatQuantity(summary.returnQuantity)} />
                              <FinanceStat label={t("finance.adjustments")} value={formatQuantity(summary.adjustmentQuantity)} />
                              <FinanceStat label={t("finance.transferOut")} value={formatQuantity(summary.transferOutQuantity)} />
                              <FinanceStat label={t("finance.transferIn")} value={formatQuantity(summary.transferInQuantity)} />
                           </div>
                        </div>
                     </section>

                     <section className="card">
                        <div className="section">
                           <div className="section-header"><div><h2 className="section-title">{t("finance.activity")}</h2><p className="section-subtitle">{t("finance.activityDesc")}</p></div></div>
                           {summary.activityLines.length === 0 ? <EmptyState icon="0" title={t("finance.noActivity")} description={t("finance.noActivityDesc")} /> : (
                              <div className="table-shell"><table className="data-table"><thead><tr><th>{t("finance.activityType")}</th><th>{t("finance.count")}</th><th>{t("finance.in")}</th><th>{t("finance.out")}</th><th>{t("finance.latest")}</th></tr></thead><tbody>{summary.activityLines.map((line) => (
                                 <tr key={line.activityType}><td><strong>{formatActivityType(line.activityType, t)}</strong></td><td>{line.count}</td><td>{formatQuantity(line.quantityIn)}</td><td>{formatQuantity(line.quantityOut)}</td><td>{formatDateTime(line.latestActivityAtUtc)}</td></tr>
                              ))}</tbody></table></div>
                           )}
                        </div>
                     </section>
                  </div>

                  <section className="card">
                     <div className="section">
                        <div className="section-header"><div><h2 className="section-title">{t("finance.valuation")}</h2><p className="section-subtitle">{t("finance.valuationDesc")}</p></div><Badge tone="role">{summary.balanceCount} {t("common.records")}</Badge></div>
                        {summary.valuationLines.length === 0 ? <EmptyState icon="0" title={t("finance.noValuation")} description={t("finance.noValuationDesc")} /> : (
                           <div className="table-shell"><table className="data-table finance-valuation-table"><thead><tr><th>{t("finance.product")}</th><th>{t("finance.location")}</th><th>{t("finance.quantity")}</th><th>{t("finance.unitPrice")}</th><th>{t("finance.value")}</th><th>{t("finance.priceSource")}</th></tr></thead><tbody>{summary.valuationLines.map((line) => (
                              <tr key={`${line.productBatchId}-${line.storageLocationId}`}><td><strong>{line.productSku}</strong><span className="muted-text block">{line.productName} · {line.batchNumber}</span></td><td>{line.siteName}<span className="muted-text block">{line.storageLocationName}</span></td><td>{formatQuantity(line.quantityOnHand)}<span className="muted-text block">{t("finance.reservedShort")} {formatQuantity(line.quantityReserved)}</span></td><td>{line.unitPrice === null ? "—" : formatMoney(line.unitPrice, line.currency)}</td><td>{formatMoney(line.valueOnHand, line.currency)}</td><td><Badge tone={line.priceStatus === "Missing" ? "warn" : "ok"}>{line.priceStatus}</Badge></td></tr>
                           ))}</tbody></table></div>
                        )}
                     </div>
                  </section>
               </>
            )}
         </div>
      </AppShell>
   );
}

function FinanceStat({ label, value, tone = "role" }: { label: string; value: string; tone?: "role" | "ok" | "warn" }) {
   return <div className="finance-stat card"><span>{label}</span><strong>{value}</strong><Badge tone={tone}>{label}</Badge></div>;
}
