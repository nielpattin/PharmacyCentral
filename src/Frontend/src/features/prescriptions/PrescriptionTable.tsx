import { Badge } from "../../components/shadcn/badge";
import type { PrescriptionDetails, SiteDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";

function prescriptionStatusTone(status: string) {
   if (status === "Draft") return "outline";
   if (status === "Dispensed") return "secondary";
   if (status === "Cancelled") return "destructive";
   return "outline";
}

type PrescriptionTableProps = {
   rows: PrescriptionDetails[];
   selectedId?: string;
   sites: SiteDto[];
   onSelect: (id: string) => void;
};

export function PrescriptionTable({ rows, selectedId = "", sites, onSelect }: PrescriptionTableProps) {
   const t = useT();
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? siteId;

   return (
      <div className="table-wrap">
         <table className="selectable-table sites-table">
            <thead>
               <tr>
                  <th>{t("prescription.prescriptionNumber")}</th>
                  <th>{t("prescription.patient")}</th>
                  <th>{t("prescription.site")}</th>
                  <th>{t("prescription.status")}</th>
                  <th>{t("prescription.created")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((prescription) => {
                  const isSelected = selectedId === prescription.id;
                  return (
                     <tr
                        key={prescription.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelect(prescription.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelect(prescription.id);
                           }
                        }}
                     >
                        <td>{prescription.prescriptionNumber}</td>
                        <td>{prescription.patientName}</td>
                        <td>{siteName(prescription.siteId)}</td>
                        <td>
                           <Badge variant={prescriptionStatusTone(prescription.status)}>
                              {t(`prescription.status.${prescription.status}`)}
                           </Badge>
                        </td>
                        <td>{new Date(prescription.createdAtUtc).toLocaleDateString()}</td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
