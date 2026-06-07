import { Badge } from "../../components/shadcn/badge";
import type { SiteDto, StocktakeSessionDetails, StorageLocationDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";

function stocktakeStatusTone(status: string) {
   if (status === "Completed") return "secondary";
   if (status === "Cancelled") return "destructive";
   return "outline";
}

type StocktakeSessionTableProps = {
   rows: StocktakeSessionDetails[];
   selectedId?: string;
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onSelect: (id: string) => void;
};

export function StocktakeSessionTable({
   rows,
   selectedId = "",
   sites,
   storageLocations,
   onSelect,
}: StocktakeSessionTableProps) {
   const t = useT();
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? "—";
   const locationName = (locationId: string) =>
      storageLocations.find((location) => location.id === locationId)?.name ?? "—";

   return (
      <div className="overflow-x-auto">
         <table className="w-full border-collapse text-sm">
            <thead>
               <tr>
                  <th>{t("stocktake.site")}</th>
                  <th>{t("stocktake.location")}</th>
                  <th>{t("stocktake.status")}</th>
                  <th>{t("stocktake.started")}</th>
                  <th>{t("stocktake.lines")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((session) => {
                  const isSelected = selectedId === session.id;
                  return (
                     <tr
                        key={session.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelect(session.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelect(session.id);
                           }
                        }}
                     >
                        <td>{siteName(session.siteId)}</td>
                        <td>{locationName(session.storageLocationId)}</td>
                        <td>
                           <Badge variant={stocktakeStatusTone(session.status)}>
                              {t(`stocktake.status.${session.status}`)}
                           </Badge>
                        </td>
                        <td>{new Date(session.startedAtUtc).toLocaleDateString()}</td>
                        <td>{session.countSheetLines.length}</td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
