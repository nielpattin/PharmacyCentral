// Tone vocabulary for the chart kit. Status tones carry meaning: success is healthy, warning is degrading, danger is
// failing, neutral is no signal. Chart tones are identity colours only and never imply a status.

export type Tone = "ok" | "warning" | "danger" | "neutral";
export type ChartTone = "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5";
/** Any colour a chart element may take: a status tone or an identity colour. */
export type DataTone = Tone | ChartTone;

/** Theme custom property that holds each tone's colour (defined in theme.css). */
const TONE_VARIABLE: Record<DataTone, string> = {
  ok: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
  neutral: "--color-muted",
  "chart-1": "--color-chart-1",
  "chart-2": "--color-chart-2",
  "chart-3": "--color-chart-3",
  "chart-4": "--color-chart-4",
  "chart-5": "--color-chart-5",
};

/** Background utility for a status tone. Neutral is a quiet grey, never a status colour. */
export const TONE_BG: Record<Tone, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-soft",
};

/** CSS colour for a tone, usable inside inline styles and SVG attributes. */
export const toneColor = (tone: DataTone): string => `var(${TONE_VARIABLE[tone]})`;
