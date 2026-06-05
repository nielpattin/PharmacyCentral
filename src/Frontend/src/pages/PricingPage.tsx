import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { archiveProductPrice, createProductPrice, loadProductPrices, loadProducts, loadSites, publishProductPrice, type ProductDto, type ProductPriceDto, type SiteDto } from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";

const today = new Date().toISOString().slice(0, 10);

type PriceForm = {
   productId: string;
   siteId: string;
   unitPrice: string;
   currency: string;
   effectiveFrom: string;
   effectiveTo: string;
   notes: string;
};

const blankForm: PriceForm = {
   productId: "",
   siteId: "",
   unitPrice: "",
   currency: "VND",
   effectiveFrom: today,
   effectiveTo: "",
   notes: "",
};

export default function PricingPage() {
   const t = useT();
   const [prices, setPrices] = useState<ProductPriceDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [selectedPriceId, setSelectedPriceId] = useState("");
   const [form, setForm] = useState<PriceForm>(blankForm);
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);

   const selectedPrice = useMemo(() => prices.find((price) => price.id === selectedPriceId) ?? null, [prices, selectedPriceId]);

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredPriceId?: string) {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [priceData, productData, siteData] = await Promise.all([loadProductPrices({ limit: 200 }), loadProducts(), loadSites()]);
         setPrices(priceData);
         setProducts(productData);
         setSites(siteData);
         const nextId = preferredPriceId ?? selectedPriceId;
         setSelectedPriceId(priceData.some((price) => price.id === nextId) ? nextId : (priceData[0]?.id ?? ""));
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadPrices"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleCreate() {
      setIsSaving(true);
      setBannerError(null);
      try {
         const created = await createProductPrice({
            productId: form.productId,
            siteId: form.siteId === "" ? null : form.siteId,
            unitPrice: Number(form.unitPrice),
            currency: form.currency.trim() || "VND",
            effectiveFrom: form.effectiveFrom,
            effectiveTo: form.effectiveTo === "" ? null : form.effectiveTo,
            notes: form.notes.trim() || null,
         });
         setForm(blankForm);
         await refreshData(created.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handlePublish() {
      if (selectedPrice === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const updated = await publishProductPrice(selectedPrice.id);
         await refreshData(updated.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleArchive() {
      if (selectedPrice === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const updated = await archiveProductPrice(selectedPrice.id);
         await refreshData(updated.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsSaving(false);
      }
   }

   return (
      <AppShell active="pricing" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.pricing") }]} />}>
         <div className="reporting-page">
            <PageHeader title={t("pricing.title")} actions={<Button variant="secondary" onClick={() => void refreshData()}>{t("common.refresh")}</Button>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <div className="reporting-grid">
               <section className="card section">
                  <div className="section-header"><div><h2 className="section-title">{t("pricing.priceList")}</h2><p className="section-subtitle">{t("pricing.priceListDesc")}</p></div><Badge tone="role">{prices.length} {t("common.records")}</Badge></div>
                  {isLoading ? <EmptyState icon="…" title={t("common.loading")} description={t("pricing.loadingDesc")} /> : prices.length === 0 ? <EmptyState icon="0" title={t("pricing.emptyTitle")} description={t("pricing.emptyDesc")} /> : (
                     <div className="table-shell"><table className="data-table"><thead><tr><th>{t("pricing.product")}</th><th>{t("pricing.site")}</th><th>{t("pricing.price")}</th><th>{t("pricing.effective")}</th><th>{t("pricing.status")}</th></tr></thead><tbody>{prices.map((price) => (
                        <tr key={price.id} className={price.id === selectedPriceId ? "selected-row" : ""} onClick={() => setSelectedPriceId(price.id)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedPriceId(price.id); }} tabIndex={0}>
                           <td><strong>{price.productSku}</strong><span className="muted-text block">{price.productName}</span></td>
                           <td>{price.siteName ?? t("pricing.allSites")}</td>
                           <td>{formatMoney(price.unitPrice, price.currency)}</td>
                           <td>{price.effectiveFrom}{price.effectiveTo ? ` → ${price.effectiveTo}` : ""}</td>
                           <td><Badge tone={price.status === "Published" ? "ok" : price.status === "Archived" ? "role" : "warn"}>{price.status}</Badge></td>
                        </tr>
                     ))}</tbody></table></div>
                  )}
               </section>

               <section className="card section">
                  <div className="section-header"><div><h2 className="section-title">{t("pricing.create")}</h2><p className="section-subtitle">{t("pricing.createDesc")}</p></div></div>
                  <div className="form-grid">
                     <Field label={t("pricing.product")} required><select className="field-input" value={form.productId} onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))}><option value="">{t("receiving.selectProduct")}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></Field>
                     <Field label={t("pricing.site")}><select className="field-input" value={form.siteId} onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}><option value="">{t("pricing.allSites")}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
                     <Field label={t("pricing.price")} required><input className="field-input" type="number" min="1" step="1" value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} /></Field>
                     <Field label={t("pricing.currency")} required><input className="field-input" value={form.currency} maxLength={3} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></Field>
                     <Field label={t("pricing.effectiveFrom")} required><input className="field-input" type="date" value={form.effectiveFrom} onChange={(event) => setForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field>
                     <Field label={t("pricing.effectiveTo")}><input className="field-input" type="date" value={form.effectiveTo} onChange={(event) => setForm((current) => ({ ...current, effectiveTo: event.target.value }))} /></Field>
                     <Field label={t("forms.notes")} className="field-wide"><textarea className="field-input field-textarea" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
                  </div>
                  <div className="form-actions"><Button variant="primary" disabled={isSaving || form.productId === "" || form.unitPrice === ""} onClick={() => void handleCreate()}>{isSaving ? t("common.saving") : t("pricing.createButton")}</Button></div>
               </section>
            </div>

            <section className="card section">
               <div className="section-header"><div><h2 className="section-title">{t("pricing.details")}</h2><p className="section-subtitle">{selectedPrice === null ? t("pricing.selectPriceDesc") : selectedPrice.productName}</p></div><div className="page-actions"><Button variant="primary" disabled={selectedPrice === null || selectedPrice.status !== "Draft" || isSaving} onClick={() => void handlePublish()}>{t("pricing.publish")}</Button><Button variant="secondary" disabled={selectedPrice === null || selectedPrice.status === "Archived" || isSaving} onClick={() => void handleArchive()}>{t("pricing.archive")}</Button></div></div>
               {selectedPrice === null ? <EmptyState icon="₫" title={t("pricing.selectPrice")} description={t("pricing.selectPriceDesc")} /> : <div className="report-source-strip"><span>{selectedPrice.productSku} · {selectedPrice.productName}</span><span>{selectedPrice.siteName ?? t("pricing.allSites")}</span><span>{formatMoney(selectedPrice.unitPrice, selectedPrice.currency)}</span><span>{selectedPrice.status}</span></div>}
            </section>
         </div>
      </AppShell>
   );
}

function formatMoney(value: number, currency: string) {
   return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(value);
}
