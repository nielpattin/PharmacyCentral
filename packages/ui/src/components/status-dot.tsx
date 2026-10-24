import { cn } from "../cn.ts";
import { TONE_BG, type Tone } from "../charts/palette.ts";

/** 8 px status dot. Pair it with text: the dot never carries meaning alone. */
export const StatusDot = ({ tone, className }: { tone: Tone; className?: string | undefined }): React.JSX.Element => (
  <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", TONE_BG[tone], className)} />
);
