import type { Db } from "../db.js";

export interface ProfileSettingRow {
  profile_id: string;
  key: string;
  value_json: string;
  updated_at: string;
}

/**
 * Key/value store for per-profile editable config (taste + system knobs).
 * Values are JSON-encoded; callers own the shape per key.
 */
export class ProfileSettingsRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  has(key: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM profile_settings WHERE profile_id = ? AND key = ?`)
      .get(this.profileId, key);
    return row !== undefined;
  }

  isEmpty(): boolean {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM profile_settings WHERE profile_id = ?`)
      .get(this.profileId) as { n: number };
    return row.n === 0;
  }

  get<T>(key: string): T | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM profile_settings WHERE profile_id = ? AND key = ?`)
      .get(this.profileId, key) as { value_json: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.value_json) as T;
  }

  all(): Record<string, unknown> {
    const rows = this.db
      .prepare(`SELECT key, value_json FROM profile_settings WHERE profile_id = ?`)
      .all(this.profileId) as Array<{ key: string; value_json: string }>;
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      out[row.key] = JSON.parse(row.value_json);
    }
    return out;
  }

  set(key: string, value: unknown, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO profile_settings (profile_id, key, value_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(profile_id, key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(this.profileId, key, JSON.stringify(value), updatedAt);
  }
}
