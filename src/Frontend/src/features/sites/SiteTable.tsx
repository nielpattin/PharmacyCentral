import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import type { SiteDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { siteTypeLabel } from "../../pages/shared/pharmacyTypes";

type SiteTableProps = {
   rows: SiteDto[];
   selectedSiteId: string;
   onSelectSite: (siteId: string) => void;
   onOpenStorageLocations: (siteId: string) => void;
   onDeleteSite: (siteId: string) => void;
};

function statusTone(status: string) {
   return status === "Active" ? "ok" : "bad";
}

export function SiteTable({
   rows,
   selectedSiteId,
   onSelectSite,
   onOpenStorageLocations,
   onDeleteSite,
}: SiteTableProps) {
   const t = useT();

   return (
      <div className="table-wrap">
         <table className="selectable-table sites-table">
            <thead>
               <tr>
                  <th>{t("sites.code")}</th>
                  <th>{t("sites.name")}</th>
                  <th>{t("sites.type")}</th>
                  <th>{t("sites.status")}</th>
                  <th>{t("common.actions")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((site) => {
                  const isSelected = selectedSiteId === site.id;
                  return (
                     <tr
                        key={site.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectSite(site.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectSite(site.id);
                           }
                        }}
                     >
                        <td>{site.code}</td>
                        <td>{site.name}</td>
                        <td>{siteTypeLabel(site.siteType, t)}</td>
                        <td>
                           <Badge tone={statusTone(site.status)}>
                              {site.status === "Active" ? t("status.active") : t("status.inactive")}
                           </Badge>
                        </td>
                        <td>
                           <div className="table-actions">
                              <Button
                                 size="sm"
                                 variant="secondary"
                                 onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenStorageLocations(site.id);
                                 }}
                              >
                                 {t("storage.storageLocations")}
                              </Button>
                              <Button
                                 size="sm"
                                 variant="danger"
                                 onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteSite(site.id);
                                 }}
                              >
                                 {t("common.delete")}
                              </Button>
                           </div>
                        </td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
