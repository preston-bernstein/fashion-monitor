import type { Db } from "../storage/db.js";
import type { Platform } from "./types.js";
import { PLATFORMS } from "./types.js";
import { ConfigSchemaWithDefaults, type Config, type SearchQueryDef } from "./config.js";
import { ProfileSettingsRepo } from "../storage/repos/profile-settings.js";
import { ScrapeQueriesRepo, type ScrapeQueryRow } from "../storage/repos/scrape-queries.js";
import type { ProfileSecretsRepo } from "../storage/repos/profile-secrets.js";

/**
 * Keys persisted in profile_settings. Secrets (ntfy token) and infra
 * (database path) are intentionally excluded and sourced from env / secret store.
 */
export const TASTE_SETTING_KEYS = [
  "measurements",
  "aesthetic_prompt",
  "hard_no",
  "positive_signals",
  "price_ceiling",
] as const;

export const SYSTEM_SETTING_KEYS = ["platforms", "llm", "alert_options", "scraper"] as const;

export interface LoadProfileConfigOptions {
  /** Encrypted secret store; consulted before fallback for ntfy token. */
  secrets?: ProfileSecretsRepo;
  /** Bootstrap config (from config.yaml) used for db path + secret fallback. */
  fallback?: Config;
  /** Explicit database path override (defaults to fallback's or built-in default). */
  databasePath?: string;
}

function groupMonitors(rows: ScrapeQueryRow[]): Partial<Record<Platform, SearchQueryDef[]>> {
  const out: Partial<Record<Platform, SearchQueryDef[]>> = {};
  for (const row of rows) {
    const platform = row.platform;
    if (!(PLATFORMS as readonly string[]).includes(platform)) continue;
    (out[platform] ??= []).push({
      id: row.id,
      q: row.query_text,
      groupId: row.group_id,
      enabled: row.enabled !== 0,
      status: (row.status as SearchQueryDef["status"]) ?? "active",
      note: row.note ?? undefined,
    });
  }
  return out;
}

/**
 * DB (this profile's own connected credential) wins over env (the
 * deployment-wide default/bootstrap value) wins over the config.yaml
 * fallback. DB-first matters once a second profile exists: a shared env var
 * must never shadow a profile's own explicitly-connected credential — see
 * self-service-onboarding.md Phase 3's Connection model.
 */
function resolveSecret(
  envName: string,
  storeKey: string,
  opts: LoadProfileConfigOptions,
  fallbackValue: string | undefined,
): string | undefined {
  if (opts.secrets?.has(storeKey)) return opts.secrets.get(storeKey);
  const env = process.env[envName];
  if (env && env.length > 0) return env;
  return fallbackValue;
}

/**
 * Build the existing Config shape from DB rows + env/secret credentials.
 * The pipeline reads this instead of YAML-only; the web writes the DB rows.
 */
export function loadProfileConfig(
  db: Db,
  profileId: string,
  opts: LoadProfileConfigOptions = {},
): Config {
  const settings = new ProfileSettingsRepo(db, profileId);
  const monitors = new ScrapeQueriesRepo(db, profileId);
  const fb = opts.fallback;

  const stored = settings.all();
  const monitorRows = monitors.listMonitors();
  const searches = monitorRows.length > 0 ? groupMonitors(monitorRows) : fb?.searches;

  const alertOptions = (stored.alert_options as Partial<Config["alert"]> | undefined) ?? {
    mode: fb?.alert.mode ?? "immediate",
    notify_empty: fb?.alert.notify_empty ?? false,
  };

  const ntfyToken = resolveSecret("NTFY_TOKEN", "ntfy_token", opts, fb?.alert.ntfy_token);
  const fbCreds = fb?.platform_credentials;
  const platformCredentials = {
    ebay_client_id: resolveSecret(
      "EBAY_CLIENT_ID",
      "ebay_client_id",
      opts,
      fbCreds?.ebay_client_id,
    ),
    ebay_client_secret: resolveSecret(
      "EBAY_CLIENT_SECRET",
      "ebay_client_secret",
      opts,
      fbCreds?.ebay_client_secret,
    ),
    grailed_app_id: resolveSecret(
      "GRAILED_APP_ID",
      "grailed_app_id",
      opts,
      fbCreds?.grailed_app_id,
    ),
    grailed_api_key: resolveSecret(
      "GRAILED_API_KEY",
      "grailed_api_key",
      opts,
      fbCreds?.grailed_api_key,
    ),
    scrapfly_api_key: resolveSecret(
      "SCRAPFLY_API_KEY",
      "scrapfly_api_key",
      opts,
      fbCreds?.scrapfly_api_key,
    ),
  };

  const raw = {
    profile_id: profileId,
    measurements: stored.measurements ?? fb?.measurements ?? {},
    aesthetic_prompt: stored.aesthetic_prompt ?? fb?.aesthetic_prompt,
    hard_no: stored.hard_no ?? fb?.hard_no ?? [],
    positive_signals: stored.positive_signals ?? fb?.positive_signals ?? { strong: [], weak: [] },
    price_ceiling: stored.price_ceiling ?? fb?.price_ceiling,
    platforms: stored.platforms ?? fb?.platforms,
    searches,
    llm: stored.llm ?? fb?.llm ?? {},
    alert: {
      ntfy_url: fb?.alert.ntfy_url ?? "http://ntfy",
      ntfy_topic: fb?.alert.ntfy_topic ?? "fashion-monitor",
      ntfy_token: ntfyToken,
      mode: alertOptions.mode ?? fb?.alert.mode ?? "immediate",
      notify_empty: alertOptions.notify_empty ?? fb?.alert.notify_empty ?? false,
    },
    database: {
      path: opts.databasePath ?? fb?.database.path ?? "data/fashion_monitor.db",
    },
    scraper: stored.scraper ?? fb?.scraper ?? { poshmark_profile_path: "data/poshmark-profile" },
    platform_credentials: platformCredentials,
  };

  return ConfigSchemaWithDefaults.parse(raw);
}
