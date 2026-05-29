import { Badge } from "../../components/ui/Badge";
import type { ProductDto, StockAdjustmentDetails, SiteDto, StorageLocationDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";

type StockAdjustmentTableProps = {
   rows: StockAdjustmentDetails[];
   products: ProductDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
};

export function StockAdjustmentTable({ rows, products, sites, storageLocations }: StockAdjustmentTableProps) {
   const t = useT();
   const productName = (id: string) => products.find((product) => product.id === id)?.name ?? id;
   const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? id;
   const locationName = (id: string) => storageLocations.find((location) => location.id === id)?.name ?? id;

   return (
      <div className="table-wrap">
         <table className="selectable-table sites-table">
            <thead><tr><th>{t("stocktake.product")}</th><th>{t("stocktake.site")}</th><th>{t("stocktake.location")}</th><th>{t("stocktake.type")}</th><th>{t("stocktake.quantity")}</th><th>{t("stocktake.reason")}</th><th>{t("stocktake.statusLabel")}</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id}><td>{productName(row.productId)}</td><td>{siteName(row.siteId)}</td><td>{locationName(row.storageLocationId)}</td><td>{row.adjustmentType}</td><td>{row.quantity}</td><td>{row.reason}</td><td><Badge tone={row.status === "Approved" ? "ok" : "warn"}>{row.status}</Badge></td></tr>)}</tbody>
         </table>
      </div>
   );
}
