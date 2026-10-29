import type { Logger } from "../../logger.ts";

import type { ActionPlanAutoCreator } from "./action-plan-auto-creator.ts";

/** How often the alerts are read again; a fixed cadence, not a tuning knob. */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Runs the automatic plan creation at boot and then on a fixed cadence. A run that fails (identity-service or the
 * catalog is down) is logged and tried again on the next tick; a tick that arrives while a run is still going is
 * dropped. The creator is idempotent, so a repeated or overlapping run creates nothing new.
 */
export class ActionPlanAutoSweeper {
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;

  public constructor(
    private readonly creator: ActionPlanAutoCreator,
    private readonly logger: Logger,
  ) {}

  public start(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  public close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async sweep(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const result = await this.creator.run();
      if (result.created > 0) this.logger.info(result, "action plans created automatically");
    } catch (error) {
      this.logger.error({ error }, "automatic action plan run failed");
    } finally {
      this.inFlight = false;
    }
  }
}
