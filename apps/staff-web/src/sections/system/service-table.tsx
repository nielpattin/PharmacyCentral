import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusDot,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tracker,
  type Tone,
} from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { formatQuantity, type SystemMetricsSummary, type SystemService, type SystemLoad } from "../../staff-api.ts";
import { DASH, formatChartTime, formatMebibytes, formatMilliseconds, formatMillicores } from "./format.ts";
import type { HealthTone } from "./health.ts";
import { buildServiceTableRows, type ServiceTableRow } from "./service-table-rows.ts";

const DOT_TONE: Record<HealthTone, Tone> = { ok: "ok", warning: "warning", danger: "danger" };

// Column headers keep sentence case. The table is for reading, not for scanning labels.
const HEAD = "normal-case tracking-normal text-sm font-medium text-muted";

const ServiceRow = ({ row, onOpen }: { row: ServiceTableRow; onOpen: (name: string) => void }): React.JSX.Element => (
  <TableRow className="hover:bg-surface-soft">
    <TableCell className="min-w-56">
      <button
        type="button"
        onClick={() => onOpen(row.name)}
        className="flex max-w-full items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <StatusDot tone={DOT_TONE[row.tone]} />
        <span className="truncate font-medium">{row.name}</span>
        {row.version ? (
          <Badge variant="outline" className="shrink-0">
            {row.version}
          </Badge>
        ) : null}
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {row.instances === null ? DASH : `${formatQuantity(row.instances)} ${translateText("instances")}`}
        </span>
      </button>
    </TableCell>
    <TableCell>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={row.status === "up" ? "success" : "danger"}>
          {translateText(row.status === "up" ? "Ready" : "Down")}
        </Badge>
        <Badge variant={row.liveStatus === "up" ? "success" : "danger"}>
          {translateText(row.liveStatus === "up" ? "Live" : "Live down")}
        </Badge>
      </div>
    </TableCell>
    <TableCell className="tabular-nums">{formatMillicores(row.cpuCores)}</TableCell>
    <TableCell className="tabular-nums">{formatMebibytes(row.memoryBytes)}</TableCell>
    <TableCell className="tabular-nums">
      {row.eventLoopLagSeconds === null ? DASH : formatMilliseconds(row.eventLoopLagSeconds * 1000)}
    </TableCell>
    <TableCell>
      <div className="grid min-w-48 gap-1">
        <Tracker data={row.tracker} className="w-full" />
        <span className="text-xs tabular-nums text-muted">
          {row.uptimePercent24h === null
            ? `${translateText("Uptime 24h")}: ${DASH}`
            : `${translateText("Uptime 24h")}: ${formatQuantity(row.uptimePercent24h)}%`}
        </span>
      </div>
    </TableCell>
  </TableRow>
);

export const ServiceTableCard = ({
  services,
  load,
  summary,
  onOpen,
}: {
  services: ReadonlyArray<SystemService>;
  load: ReadonlyArray<SystemLoad> | undefined;
  summary: SystemMetricsSummary | undefined;
  onOpen: (name: string) => void;
}): React.JSX.Element => {
  const rows = buildServiceTableRows(
    services,
    load,
    summary,
    (unixSeconds, ratio) =>
      `${formatChartTime(unixSeconds, false)} · ${ratio === null ? DASH : `${formatQuantity(ratio * 100)}%`}`,
  );
  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3 border-b-0">
        <div className="grid gap-1">
          <CardTitle className="text-sm font-medium">{translateText("Services")}</CardTitle>
          <CardDescription>
            {translateText("Readiness, liveness, resources and uptime per service. Select a row for its detail.")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>{translateText("Service")}</TableHead>
              <TableHead className={HEAD}>{translateText("State")}</TableHead>
              <TableHead className={HEAD}>{translateText("CPU")}</TableHead>
              <TableHead className={HEAD}>{translateText("Memory")}</TableHead>
              <TableHead className={HEAD}>{translateText("Event loop lag")}</TableHead>
              <TableHead className={HEAD}>{translateText("Uptime 24h")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <ServiceRow key={row.name} row={row} onOpen={onOpen} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
