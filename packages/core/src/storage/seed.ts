import type { Config } from "../core/config.js";
import type { Db } from "./db.js";
import { ProfilesRepo } from "./repos/users.js";
import { ProfileSettingsRepo } from "./repos/profile-settings.js";
import { SearchGroupsRepo } from "./repos/search-groups.js";

/**
 * First-boot migration safety: seed DB-backed config from the existing
 * config.yaml so nothing breaks. Idempotent — only writes when the profile's
 * stores are empty, so subsequent web edits are never clobbered.
 */
export function seedProfileFromConfig(db: Db, config: Config, now: string): void {
  const profileId = config.profile_id;
  new ProfilesRepo(db).ensure(profileId, profileId, now);

  const groups = new SearchGroupsRepo(db, profileId);
  if (groups.listGroups().length === 0) {
    groups.syncFromConfig(config, now);
  }

  const settings = new ProfileSettingsRepo(db, profileId);
  if (settings.isEmpty()) {
    settings.set("measurements", config.measurements, now);
    settings.set("aesthetic_prompt", config.aesthetic_prompt, now);
    settings.set("hard_no", config.hard_no, now);
    settings.set("positive_signals", config.positive_signals, now);
    settings.set("price_ceiling", config.price_ceiling, now);
    settings.set("platforms", config.platforms, now);
    settings.set("llm", config.llm, now);
    settings.set(
      "alert_options",
      { mode: config.alert.mode, notify_empty: config.alert.notify_empty },
      now,
    );
    settings.set("scraper", config.scraper, now);
  }
}
