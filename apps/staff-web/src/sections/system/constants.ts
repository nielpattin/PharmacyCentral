/** How often the overview refetches while mounted. */
export const SYSTEM_REFRESH_INTERVAL_MS = 15_000;
/**
 * The service detail charts read Prometheus range queries. The data moves slowly relative to a 60-point window, so they
 * refetch on this slower cadence.
 */
export const SYSTEM_HEAVY_REFRESH_INTERVAL_MS = 60_000;
/** The window the overview and the service sheet open with. Both pickers can change it afterwards. */
export const DEFAULT_SYSTEM_WINDOW_MINUTES = 60;
