import type { Db } from "../db.js";

export interface AuditEntry {
  userId: number | null;
  actorEmail: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
}

export interface AuditRow {
  id: number;
  profile_id: string;
  user_id: number | null;
  actor_email: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  recorded_at: string;
}

export type AuditCategory =
  | "auth"
  | "monitors"
  | "settings"
  | "secrets"
  | "users"
  | "system";

export interface AuditFilterParams {
  limit?: number;
  offset?: number;
  actionPrefix?: string;
  actorEmail?: string;
  since?: string;
  category?: AuditCategory;
}

const CATEGORY_SQL: Record<AuditCategory, string> = {
  auth: `(action LIKE 'login.%' OR action LIKE 'auth.%' OR action = 'logout')`,
  monitors: `action LIKE 'monitor.%'`,
  settings: `(action LIKE 'taste.%' OR action = 'system.update')`,
  secrets: `(action LIKE 'secret.%' OR action LIKE 'pipeline.%')`,
  users: `action LIKE 'user.%'`,
  system: `action LIKE 'system.%'`,
};

function buildAuditWhere(
  profileId: string,
  filters: AuditFilterParams,
): { clause: string; params: unknown[] } {
  const clauses = ["profile_id = ?"];
  const params: unknown[] = [profileId];

  if (filters.category) {
    clauses.push(CATEGORY_SQL[filters.category]);
  } else if (filters.actionPrefix) {
    clauses.push("action LIKE ?");
    params.push(`${filters.actionPrefix}%`);
  }

  if (filters.actorEmail) {
    clauses.push("actor_email = ?");
    params.push(filters.actorEmail);
  }

  if (filters.since) {
    clauses.push("recorded_at >= ?");
    params.push(filters.since);
  }

  return { clause: clauses.join(" AND "), params };
}

export class AuditLogRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  record(entry: AuditEntry, recordedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (profile_id, user_id, actor_email, action, target, detail, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.profileId,
        entry.userId,
        entry.actorEmail,
        entry.action,
        entry.target ?? null,
        entry.detail ?? null,
        recordedAt,
      );
  }

  /** Record an audit entry with structured detail JSON (requestId, etc.). */
  recordFromRequest(
    actor: { userId: number | null; actorEmail: string | null },
    action: string,
    recordedAt: string,
    options?: { target?: string | null; detail?: Record<string, unknown> },
  ): void {
    this.record(
      {
        userId: actor.userId,
        actorEmail: actor.actorEmail,
        action,
        target: options?.target ?? null,
        detail: options?.detail ? JSON.stringify(options.detail) : null,
      },
      recordedAt,
    );
  }

  fetchRecent(limit = 50): AuditRow[] {
    return this.fetchFiltered({ limit, offset: 0 }).entries;
  }

  fetchFiltered(filters: AuditFilterParams = {}): { entries: AuditRow[]; total: number } {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);
    const { clause, params } = buildAuditWhere(this.profileId, filters);

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE ${clause}`).get(...params) as {
        c: number;
      }
    ).c;

    const entries = this.db
      .prepare(
        `SELECT id, profile_id, user_id, actor_email, action, target, detail, recorded_at
         FROM audit_log
         WHERE ${clause}
         ORDER BY recorded_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AuditRow[];

    return { entries, total };
  }
}
