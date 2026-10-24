/** Tabs of the System page, in display order. The value is also the `tab` search param and the English label. */
export const SYSTEM_TABS = ["Services", "Messaging", "API routes", "Dashboards"] as const;

export type SystemTab = (typeof SYSTEM_TABS)[number];

export const isSystemTab = (value: string): value is SystemTab => (SYSTEM_TABS as readonly string[]).includes(value);
