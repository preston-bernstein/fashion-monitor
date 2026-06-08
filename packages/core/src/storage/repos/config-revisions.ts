import { createHash } from "node:crypto";
import type { Config } from "../../core/config.js";
import { DEFAULT_SEARCHES } from "../../config/searches.js";
import type { Platform } from "../../core/types.js";
import { PLATFORMS } from "../../core/types.js";
import type { Db } from "../db.js";

export interface ConfigSnapshot {
  aesthetic_prompt: string;
  hard_no: string[];
  positive_signals: Config["positive_signals"];
  searches: Config["searches"];
  resolved_searches: Record<
    Platform,
    Array<{ id: string; q: string; status: string; note?: string }>
  >;
}

export function buildConfigSnapshot(config: Config): ConfigSnapshot {
  const resolved_searches = {} as ConfigSnapshot["resolved_searches"];
  for (const platform of PLATFORMS) {
    const entries = config.searches?.[platform] ?? DEFAULT_SEARCHES[platform];
    resolved_searches[platform] = entries.map((e) => ({
      id: e.id,
      q: e.q,
      status: e.status ?? "active",
      note: e.note,
    }));
  }

  return {
    aesthetic_prompt: config.aesthetic_prompt,
    hard_no: config.hard_no,
    positive_signals: config.positive_signals,
    searches: config.searches,
    resolved_searches,
  };
}

export function configContentHash(config: Config): string {
  const snapshot = buildConfigSnapshot(config);
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export interface ConfigRevisionRow {
  id: number;
  profile_id: string;
  recorded_at: string;
  content_hash: string;
  snapshot_json: string;
  run_id: number | null;
  changed_by_user_id: number | null;
}

export class ConfigRevisionsRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  maybeSnapshot(
    config: Config,
    runId: number | null,
    recordedAt: string,
    changedByUserId: number | null = null,
  ): boolean {
    const hash = configContentHash(config);
    const latest = this.latestHash();
    if (latest === hash) return false;

    const snapshot = buildConfigSnapshot(config);
    this.db
      .prepare(
        `INSERT INTO config_revisions (profile_id, recorded_at, content_hash, snapshot_json, run_id, changed_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(this.profileId, recordedAt, hash, JSON.stringify(snapshot), runId, changedByUserId);

    return true;
  }

  latestHash(): string | null {
    const row = this.db
      .prepare(
        `SELECT content_hash FROM config_revisions
         WHERE profile_id = ? ORDER BY recorded_at DESC LIMIT 1`,
      )
      .get(this.profileId) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }

  fetchRecent(limit = 10): ConfigRevisionRow[] {
    return this.db
      .prepare(
        `SELECT id, profile_id, recorded_at, content_hash, snapshot_json, run_id, changed_by_user_id
         FROM config_revisions
         WHERE profile_id = ?
         ORDER BY recorded_at DESC
         LIMIT ?`,
      )
      .all(this.profileId, limit) as ConfigRevisionRow[];
  }
}
