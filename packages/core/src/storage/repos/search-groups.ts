import type { Config } from "../../core/config.js";
import { DEFAULT_SEARCHES } from "../../config/searches.js";
import type { Platform } from "../../core/types.js";
import { PLATFORMS } from "../../core/types.js";
import { MAX_MONITORS_PER_PROFILE } from "@fm/shared/limits.js";
import type { Db } from "../db.js";
import type { ScrapeQueryRow } from "./scrape-queries.js";

/**
 * Thrown when a profile would exceed `MAX_MONITORS_PER_PROFILE` by creating
 * another Monitor (search group). Both the web API and the MCP server share
 * this single enforcement point (`SearchGroupsRepo.assertMonitorCapNotExceeded`)
 * so the cap can't drift between the two write paths.
 */
export class MonitorCapExceededError extends Error {
  constructor(public readonly limit: number) {
    super(`Profile has reached the maximum of ${limit} monitors`);
    this.name = "MonitorCapExceededError";
  }
}

export interface SearchGroupRow {
  id: string;
  profile_id: string;
  query_text: string;
  platforms: Platform[];
  query_overrides: Partial<Record<Platform, string>>;
  enabled: number;
  status: string;
  note: string | null;
  updated_at: string;
}

export interface SearchGroupScorecardRow {
  group_id: string;
  query_text: string;
  platforms: string;
  status: string;
  note: string | null;
  total_runs: number;
  listings_found: number;
  listings_new: number;
  scored_yes: number;
  alerts_sent: number;
  alert_rate: number | null;
  yes_rate: number | null;
  feedback_positive: number;
  feedback_negative: number;
  feedback_ratio: number | null;
  last_alert_at: string | null;
  last_good_signal_at: string | null;
}

export function executionId(groupId: string, platform: Platform): string {
  return `${groupId}@${platform}`;
}

export function parseExecutionId(id: string): { groupId: string; platform: Platform } | null {
  const idx = id.lastIndexOf("@");
  if (idx <= 0 || idx === id.length - 1) return null;
  const platform = id.slice(idx + 1);
  if (!(PLATFORMS as readonly string[]).includes(platform)) return null;
  return { groupId: id.slice(0, idx), platform: platform as Platform };
}

function parsePlatforms(json: string): Platform[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
}

function parseOverrides(json: string | null): Partial<Record<Platform, string>> {
  if (!json) return {};
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  const out: Partial<Record<Platform, string>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if ((PLATFORMS as readonly string[]).includes(key) && typeof value === "string") {
      out[key as Platform] = value;
    }
  }
  return out;
}

function rowToGroup(row: {
  id: string;
  profile_id: string;
  query_text: string;
  platforms: string;
  query_overrides: string | null;
  enabled: number;
  status: string;
  note: string | null;
  updated_at: string;
}): SearchGroupRow {
  return {
    id: row.id,
    profile_id: row.profile_id,
    query_text: row.query_text,
    platforms: parsePlatforms(row.platforms),
    query_overrides: parseOverrides(row.query_overrides),
    enabled: row.enabled,
    status: row.status,
    note: row.note,
    updated_at: row.updated_at,
  };
}

export class SearchGroupsRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  listGroups(): SearchGroupRow[] {
    return (
      this.db
        .prepare(
          `SELECT id, profile_id, query_text, platforms, query_overrides, enabled, status, note, updated_at
           FROM search_groups WHERE profile_id = ?
           ORDER BY id`,
        )
        .all(this.profileId) as Array<{
        id: string;
        profile_id: string;
        query_text: string;
        platforms: string;
        query_overrides: string | null;
        enabled: number;
        status: string;
        note: string | null;
        updated_at: string;
      }>
    ).map(rowToGroup);
  }

  countGroups(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM search_groups WHERE profile_id = ?`)
      .get(this.profileId) as { count: number };
    return row.count;
  }

  /**
   * Enforces `MAX_MONITORS_PER_PROFILE` at Monitor-create time. Call this
   * before `createGroup` from any user-initiated create path (web API,
   * MCP `add_monitor`); it is intentionally NOT baked into `createGroup`
   * itself so that config-driven bootstrap seeding (`syncFromConfig`) is
   * never blocked by it.
   */
  assertMonitorCapNotExceeded(): void {
    if (this.countGroups() >= MAX_MONITORS_PER_PROFILE) {
      throw new MonitorCapExceededError(MAX_MONITORS_PER_PROFILE);
    }
  }

  getGroup(id: string): SearchGroupRow | undefined {
    const row = this.db
      .prepare(
        `SELECT id, profile_id, query_text, platforms, query_overrides, enabled, status, note, updated_at
         FROM search_groups WHERE profile_id = ? AND id = ?`,
      )
      .get(this.profileId, id) as
      | {
          id: string;
          profile_id: string;
          query_text: string;
          platforms: string;
          query_overrides: string | null;
          enabled: number;
          status: string;
          note: string | null;
          updated_at: string;
        }
      | undefined;
    return row ? rowToGroup(row) : undefined;
  }

  createGroup(
    group: {
      id: string;
      query_text: string;
      platforms: Platform[];
      query_overrides: Partial<Record<Platform, string>>;
      enabled: boolean;
      status: string;
      note: string | null;
    },
    updatedAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO search_groups (
           id, profile_id, query_text, platforms, query_overrides, enabled, status, note, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        group.id,
        this.profileId,
        group.query_text,
        JSON.stringify(group.platforms),
        Object.keys(group.query_overrides).length > 0
          ? JSON.stringify(group.query_overrides)
          : null,
        group.enabled ? 1 : 0,
        group.status,
        group.note,
        updatedAt,
      );
    const created = this.getGroup(group.id);
    if (created) this.syncExecutions(created, updatedAt);
  }

  updateGroup(
    id: string,
    fields: {
      query_text: string;
      platforms: Platform[];
      query_overrides: Partial<Record<Platform, string>>;
      enabled: boolean;
      status: string;
      note: string | null;
    },
    updatedAt: string,
  ): void {
    this.db
      .prepare(
        `UPDATE search_groups SET
           query_text = ?, platforms = ?, query_overrides = ?, enabled = ?, status = ?, note = ?, updated_at = ?
         WHERE profile_id = ? AND id = ?`,
      )
      .run(
        fields.query_text,
        JSON.stringify(fields.platforms),
        Object.keys(fields.query_overrides).length > 0
          ? JSON.stringify(fields.query_overrides)
          : null,
        fields.enabled ? 1 : 0,
        fields.status,
        fields.note,
        updatedAt,
        this.profileId,
        id,
      );
    const group = this.getGroup(id);
    if (group) this.syncExecutions(group, updatedAt);
  }

  deleteGroup(id: string): void {
    this.db
      .prepare(`DELETE FROM scrape_queries WHERE profile_id = ? AND group_id = ?`)
      .run(this.profileId, id);
    this.db
      .prepare(`DELETE FROM search_groups WHERE profile_id = ? AND id = ?`)
      .run(this.profileId, id);
  }

  listExecutions(groupId: string): ScrapeQueryRow[] {
    return this.db
      .prepare(
        `SELECT id, profile_id, platform, query_text, enabled, status, note, updated_at, group_id
         FROM scrape_queries WHERE profile_id = ? AND group_id = ?
         ORDER BY platform`,
      )
      .all(this.profileId, groupId) as ScrapeQueryRow[];
  }

  listAllExecutions(): ScrapeQueryRow[] {
    return this.db
      .prepare(
        `SELECT id, profile_id, platform, query_text, enabled, status, note, updated_at, group_id
         FROM scrape_queries WHERE profile_id = ?
         ORDER BY group_id, platform`,
      )
      .all(this.profileId) as ScrapeQueryRow[];
  }

  syncFromConfig(config: Config, updatedAt: string): void {
    const byGroup = new Map<
      string,
      {
        platforms: Platform[];
        query_text: string;
        query_overrides: Partial<Record<Platform, string>>;
        enabled: boolean;
        status: string;
        note: string | null;
      }
    >();

    for (const platform of PLATFORMS) {
      const entries = config.searches?.[platform] ?? DEFAULT_SEARCHES[platform];
      for (const entry of entries) {
        const groupId = entry.groupId ?? entry.id;
        const existing = byGroup.get(groupId);
        if (existing) {
          if (!existing.platforms.includes(platform)) {
            existing.platforms.push(platform);
          }
          if (entry.q !== existing.query_text) {
            existing.query_overrides[platform] = entry.q;
          }
        } else {
          byGroup.set(groupId, {
            platforms: [platform],
            query_text: entry.q,
            query_overrides: {},
            enabled: entry.enabled !== false,
            status: entry.status ?? "active",
            note: entry.note ?? null,
          });
        }
      }
    }

    for (const [groupId, fields] of byGroup) {
      const payload = {
        query_text: fields.query_text,
        platforms: fields.platforms,
        query_overrides: fields.query_overrides,
        enabled: fields.enabled,
        status: fields.status,
        note: fields.note,
      };
      if (this.getGroup(groupId)) {
        this.updateGroup(groupId, payload, updatedAt);
      } else {
        this.createGroup({ id: groupId, ...payload }, updatedAt);
      }
    }
  }

  syncExecutions(group: SearchGroupRow, updatedAt: string): void {
    const upsert = this.db.prepare(
      `INSERT INTO scrape_queries (id, profile_id, platform, query_text, enabled, status, note, updated_at, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id, profile_id) DO UPDATE SET
         platform = excluded.platform,
         query_text = excluded.query_text,
         enabled = excluded.enabled,
         status = excluded.status,
         note = excluded.note,
         updated_at = excluded.updated_at,
         group_id = excluded.group_id`,
    );

    const desired = new Set(group.platforms);
    for (const platform of group.platforms) {
      const id = executionId(group.id, platform);
      const queryText = group.query_overrides[platform] ?? group.query_text;
      upsert.run(
        id,
        this.profileId,
        platform,
        queryText,
        group.enabled ? 1 : 0,
        group.status,
        group.note,
        updatedAt,
        group.id,
      );
    }

    const existing = this.listExecutions(group.id);
    const remove = this.db.prepare(`DELETE FROM scrape_queries WHERE profile_id = ? AND id = ?`);
    for (const row of existing) {
      if (!desired.has(row.platform)) {
        remove.run(this.profileId, row.id);
      }
    }
  }

  fetchGroupScorecard(): SearchGroupScorecardRow[] {
    return this.db
      .prepare(
        `SELECT group_id, query_text, platforms, status, note, total_runs,
                listings_found, listings_new, scored_yes, alerts_sent,
                alert_rate, yes_rate, feedback_positive, feedback_negative,
                feedback_ratio, last_alert_at, last_good_signal_at
         FROM v_search_group_scorecard
         WHERE profile_id = ?
         ORDER BY alerts_sent DESC, listings_new DESC`,
      )
      .all(this.profileId) as SearchGroupScorecardRow[];
  }

  fetchLastRunByExecution(
    executionIds: string[],
  ): Map<string, { error: string | null; run_started_at: string | null }> {
    const out = new Map<string, { error: string | null; run_started_at: string | null }>();
    if (executionIds.length === 0) return out;

    const placeholders = executionIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT sqr.query_id, sqr.error, r.started_at AS run_started_at
         FROM scrape_query_runs sqr
         JOIN runs r ON r.id = sqr.run_id
         WHERE sqr.profile_id = ?
           AND sqr.query_id IN (${placeholders})
           AND sqr.id = (
             SELECT MAX(sqr2.id) FROM scrape_query_runs sqr2
             WHERE sqr2.profile_id = sqr.profile_id AND sqr2.query_id = sqr.query_id
           )`,
      )
      .all(this.profileId, ...executionIds) as Array<{
      query_id: string;
      error: string | null;
      run_started_at: string;
    }>;

    for (const row of rows) {
      out.set(row.query_id, { error: row.error, run_started_at: row.run_started_at });
    }
    return out;
  }
}
