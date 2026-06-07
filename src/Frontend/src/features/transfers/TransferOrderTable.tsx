import { Badge } from "../../components/shadcn/badge";
import type { SiteDto, StorageLocationDto, TransferOrderDetails } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";

function transferStatusVariant(status: string) {
   if (status === "Approved" || status === "Received") return "secondary" as const;
   if (status === "Cancelled") return "destructive" as const;
   return "outline" as const;
}

type TransferOrderTableProps = {
   rows: TransferOrderDetails[];
   selectedId?: string;
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onSelect: (id: string) => void;
};

export function TransferOrderTable({
   rows,
   selectedId = "",
   sites,
   storageLocations,
   onSelect,
}: TransferOrderTableProps) {
   const t = useT();
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? "—";
   const locationName = (locationId: string) =>
      storageLocations.find((location) => location.id === locationId)?.name ?? "—";

   return (
      <div className="overflow-x-auto">
         <table className="w-full border-collapse text-sm">
            <thead>
               <tr>
                  <th>{t("transfer.transferNumber")}</th>
                  <th>{t("transfer.source")}</th>
                  <th>{t("transfer.destination")}</th>
                  <th>{t("transfer.status")}</th>
                  <th>{t("transfer.created")}</th>
                  <th>{t("transfer.lines")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((transfer) => {
                  const isSelected = selectedId === transfer.id;
                  return (
                     <tr
                        key={transfer.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelect(transfer.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelect(transfer.id);
                           }
                        }}
                     >
                        <td>{transfer.transferNumber}</td>
                        <td>
                           {siteName(transfer.sourceSiteId)} Â· {locationName(transfer.sourceStorageLocationId)}
                        </td>
                        <td>
                           {siteName(transfer.destinationSiteId)} Â·{" "}
                           {locationName(transfer.destinationStorageLocationId)}
                        </td>
                        <td>
                           <Badge variant={transferStatusVariant(transfer.status)}>
                              {t(`transfer.status.${transfer.status}`)}
                           </Badge>
                        </td>
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
