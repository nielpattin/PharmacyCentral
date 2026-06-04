import { Badge } from "../../components/ui/Badge";
import type { AuditLogEntryDto, SiteDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { formatAuditSummary } from "../../lib/auditDisplay";

function auditActionTone(action: string) {
   if (action === "Deleted" || action === "Cancelled") return "bad";
   if (action === "Updated") return "warn";
   return "ok";
}

function shortId(id: string | null) {
   return id === null ? "" : id.slice(0, 8);
}

type AuditLogTableProps = {
   rows: AuditLogEntryDto[];
   selectedId?: string;
   sites: SiteDto[];
   onSelect: (id: string) => void;
};

export function AuditLogTable({ rows, selectedId = "", sites, onSelect }: AuditLogTableProps) {
   const t = useT();
   const siteName = (siteId: string | null) =>
      siteId === null ? t("audit.system") : (sites.find((site) => site.id === siteId)?.name ?? siteId);

   return (
      <div className="table-wrap">
         <table className="selectable-table audit-table">
            <thead>
               <tr>
                  <th>{t("audit.occurredAt")}</th>
                  <th>{t("audit.action")}</th>
                  <th>{t("audit.entityType")}</th>
                  <th>{t("audit.summary")}</th>
                  <th>{t("audit.site")}</th>
                  <th>{t("audit.userId")}</th>
               </tr>
            </thead>
            <tbody>
               {rows.map((log) => {
                  const isSelected = selectedId === log.id;
                  return (
                     <tr
                        key={log.id}
                        className={isSelected ? "is-selected" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelect(log.id)}
                        onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelect(log.id);
                           }
                        }}
                     >
                        <td>{new Date(log.occurredAtUtc).toLocaleString()}</td>
                        <td>
                           <Badge tone={auditActionTone(log.action)}>{t(`audit.action.${log.action}`)}</Badge>
                        </td>
                        <td>{t(`audit.entity.${log.entityType}`)}</td>
                        <td>{formatAuditSummary(t, log.summary, log.entityId ?? t("common.noData"))}</td>
                        <td>{siteName(log.siteId)}</td>
                        <td title={log.userId ?? undefined}>
                           {log.userId === null ? t("audit.system") : shortId(log.userId)}
                        </td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
