import { ToggleGroup, ToggleGroupItem } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { SYSTEM_METRICS_WINDOWS_MINUTES, type SystemMetricsWindowMinutes } from "../../staff-api.ts";

const WINDOW_LABELS: Record<SystemMetricsWindowMinutes, string> = {
  15: "15 min",
  60: "1 h",
  360: "6 h",
  1440: "24 h",
};

// One picker drives every period-based panel on the page, so they all describe the same period.
export const WindowPicker = ({
  value,
  onChange,
}: {
  value: SystemMetricsWindowMinutes;
  onChange: (minutes: SystemMetricsWindowMinutes) => void;
}): React.JSX.Element => (
  <ToggleGroup
    aria-label={translateText("Time window")}
    value={String(value)}
    onValueChange={(next) => {
      const minutes = SYSTEM_METRICS_WINDOWS_MINUTES.find((candidate) => String(candidate) === next);
      if (minutes !== undefined) onChange(minutes);
    }}
  >
    {SYSTEM_METRICS_WINDOWS_MINUTES.map((minutes) => (
      <ToggleGroupItem key={minutes} value={String(minutes)}>
        {translateText(WINDOW_LABELS[minutes])}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);
