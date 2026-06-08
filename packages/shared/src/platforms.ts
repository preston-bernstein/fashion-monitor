/** Platforms tracked in config/UI. Vinted is listed but has no scraper implementation yet. */
export const PLATFORMS = ["ebay", "grailed", "vestiaire", "vinted", "depop", "poshmark"] as const;

export type Platform = (typeof PLATFORMS)[number];

export const IMPLEMENTED_PLATFORMS = ["ebay", "grailed", "vestiaire", "depop", "poshmark"] as const;

export type ImplementedPlatform = (typeof IMPLEMENTED_PLATFORMS)[number];

export type ScoreVerdict = "YES" | "MAYBE" | "NO" | "PENDING";

export const MONITOR_STATUSES = ["active", "needs_revision", "paused"] as const;

export type MonitorStatus = (typeof MONITOR_STATUSES)[number];
