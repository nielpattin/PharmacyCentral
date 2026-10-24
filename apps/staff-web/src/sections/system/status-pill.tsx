import { StatusDot, type Tone } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { formatQuantity } from "../../staff-api.ts";
import { overallStatus, type OverallHealth } from "./health.ts";

const DOT_TONE: Record<"unknown" | "healthy" | "down" | "degraded", Tone> = {
  unknown: "neutral",
  healthy: "ok",
  down: "danger",
  degraded: "warning",
};

// The page-level status line. Quiet text with a dot, not a banner.
export const StatusPill = ({ overall }: { overall: OverallHealth }): React.JSX.Element => {
  const status = overallStatus(overall);
  let text: string;
  switch (status.kind) {
    case "unknown":
      text = translateText("Service health is unavailable");
      break;
    case "healthy":
      text = translateText("All services are operating normally");
      break;
    case "down":
      text = `${formatQuantity(status.count)} ${translateText("services down")}`;
      break;
    case "degraded":
      text = `${formatQuantity(status.count)} ${translateText("services degraded")}`;
      break;
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm">
      <StatusDot tone={DOT_TONE[status.kind]} />
      <span>{text}</span>
    </span>
  );
};
