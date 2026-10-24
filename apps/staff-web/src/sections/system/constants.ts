/** How often the overview refetches while mounted. */
export const SYSTEM_REFRESH_INTERVAL_MS = 15_000;
/**
 * The service detail charts read Prometheus range queries. The data moves slowly relative to a 60-point window, so they
 * refetch on this slower cadence.
 */
export const SYSTEM_HEAVY_REFRESH_INTERVAL_MS = 60_000;
/** The window the overview and the service sheet open with. Both pickers can change it afterwards. */
export const DEFAULT_SYSTEM_WINDOW_MINUTES = 60;
/**
 * The service catalog and the route table are constants of ops-console-service, so a fetched copy stays fresh for a
 * long time and is not refetched when the page or the sheet opens again.
 */
export const SYSTEM_STATIC_STALE_MS = 10 * 60_000;
