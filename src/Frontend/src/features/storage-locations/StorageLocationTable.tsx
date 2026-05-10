import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import type { StorageLocationDto } from "../../api/pharmacyClient";
import { useLanguage, useT } from "../../lib/i18n";
import { storageLocationTypeLabel } from "../../pages/shared/pharmacyTypes";

type StorageLocationTableProps = {
   rows: StorageLocationDto[];
   selectedStorageLocationId: string;
   onSelectStorageLocation: (storageLocationId: string) => void;
   onDeleteStorageLocation: (storageLocationId: string) => void;
};

function statusTone(status: string) {
   return status === "Active" ? "ok" : "bad";
}

function formatCapacity(capacity: number | null, language: "en" | "vi") {
   return capacity === null ? "—" : capacity.toLocaleString(language === "vi" ? "vi-VN" : "en-US");
}

export function StorageLocationTable({
   rows,
   selectedStorageLocationId,
   onSelectStorageLocation,
   onDeleteStorageLocation,
}: StorageLocationTableProps) {
   const language = useLanguage();
   const t = useT();

   return (
      <div className="table-wrap">
         <table className="selectable-table storage-table">
            <thead>
               <tr>
                  <th>{t("sites.code")}</th>
                  <th>{t("storage.name")}</th>
                  <th>{t("storage.type")}</th>
                  <th>{t("storage.capacity")}</th>
                  <th>{t("sites.status")}</th>
                  <th>{t("common.actions")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((location) => {
                  const isSelected = selectedStorageLocationId === location.id;
                  return (
                     <tr
                        key={location.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectStorageLocation(location.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectStorageLocation(location.id);
                           }
                        }}
                     >
                        <td>{location.code}</td>
                        <td>{location.name}</td>
                        <td>{storageLocationTypeLabel(location.locationType, t)}</td>
                        <td>{formatCapacity(location.capacity, language)}</td>
                        <td>
                           <Badge tone={statusTone(location.status)}>
                              {location.status === "Active" ? t("status.active") : t("status.inactive")}
                           </Badge>
                        </td>
                        <td>
                           <Button
                              size="sm"
                              variant="danger"
                              onClick={(event) => {
                                 event.stopPropagation();
                                 onDeleteStorageLocation(location.id);
                              }}
                           >
                              {t("common.delete")}
                           </Button>
                        </td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
