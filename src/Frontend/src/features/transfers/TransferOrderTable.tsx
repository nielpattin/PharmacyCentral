import { Badge } from "../../components/ui/Badge";
import type { SiteDto, StorageLocationDto, TransferOrderDetails } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";

function transferStatusTone(status: string) {
   if (status === "Approved" || status === "Received") return "ok";
   if (status === "Cancelled") return "bad";
   return "warn";
}

type TransferOrderTableProps = {
   rows: TransferOrderDetails[];
   selectedId?: string;
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onSelect: (id: string) => void;
};

export function TransferOrderTable({ rows, selectedId = "", sites, storageLocations, onSelect }: TransferOrderTableProps) {
   const t = useT();
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? siteId;
   const locationName = (locationId: string) => storageLocations.find((location) => location.id === locationId)?.name ?? locationId;

   return (
      <div className="table-wrap">
         <table className="selectable-table sites-table">
            <thead><tr><th>{t("transfer.transferNumber")}</th><th>{t("transfer.source")}</th><th>{t("transfer.destination")}</th><th>{t("transfer.status")}</th><th>{t("transfer.created")}</th><th>{t("transfer.lines")}</th></tr></thead>
            <tbody>
               {rows.map((transfer) => {
                  const isSelected = selectedId === transfer.id;
                  return (
                     <tr key={transfer.id} className={isSelected ? "is-selected" : undefined} role="button" tabIndex={0} onClick={() => onSelect(transfer.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(transfer.id); } }}>
                        <td>{transfer.transferNumber}</td>
                        <td>{siteName(transfer.sourceSiteId)} · {locationName(transfer.sourceStorageLocationId)}</td>
                        <td>{siteName(transfer.destinationSiteId)} · {locationName(transfer.destinationStorageLocationId)}</td>
                        <td><Badge tone={transferStatusTone(transfer.status)}>{t(`transfer.status.${transfer.status}`)}</Badge></td>
                        <td>{new Date(transfer.createdAtUtc).toLocaleDateString()}</td>
                        <td>{transfer.lines.length}</td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
