import { Alert, StatusCell, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { formatQuantity, type SystemQueue, type SystemSectionResult } from "../../staff-api.ts";
import { SectionCard } from "./system-cards.tsx";
import { buildQueueRows, queueTotals, type QueueRow, type QueueStatus } from "./queue-rows.ts";

const HEAD = "normal-case tracking-normal text-sm font-medium text-muted";

const STATUS_LABEL: Record<QueueStatus, string> = {
  ok: "Healthy",
  no_consumers: "No consumers",
  dead_letter: "Dead letter",
};

const QueueStatusBadge = ({ row }: { row: QueueRow }): React.JSX.Element => (
  <StatusCell tone={row.tone === "danger" ? "danger" : row.tone === "warning" ? "warning" : "success"}>
    {translateText(STATUS_LABEL[row.status])}
  </StatusCell>
);

// Messages waiting and consumers per queue, with the queues that need attention first.
export const QueuesCard = ({ queues }: { queues: SystemSectionResult<SystemQueue[]> }): React.JSX.Element => {
  const rows = queues.status === "ok" ? buildQueueRows(queues.data) : [];
  const totals = queueTotals(rows);
  return (
    <SectionCard
      title="Queues"
      description="Messages waiting and consumers per queue, with the queues that need attention first."
    >
      {queues.status === "unavailable" ? (
        <Alert variant="danger">{translateText(queues.error)}</Alert>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{translateText("No queues reported.")}</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {totals.needAttention === 0
              ? `${formatQuantity(rows.length)} ${translateText("queues, all healthy")}`
              : `${formatQuantity(totals.needAttention)} ${translateText("of")} ${formatQuantity(rows.length)} ${translateText("queues need attention")}`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD}>{translateText("Queue")}</TableHead>
                <TableHead className={`${HEAD} text-right`}>{translateText("Ready")}</TableHead>
                <TableHead className={`${HEAD} text-right`}>{translateText("Unacknowledged")}</TableHead>
                <TableHead className={`${HEAD} text-right`}>{translateText("Consumers")}</TableHead>
                <TableHead className={HEAD}>{translateText("Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="max-w-64 truncate font-medium" title={row.name}>
                    {row.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuantity(row.ready)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuantity(row.unacknowledged)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuantity(row.consumers)}</TableCell>
                  <TableCell>
                    <QueueStatusBadge row={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </SectionCard>
  );
};
