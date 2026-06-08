import { randomBytes } from "node:crypto";
import type { Db } from "../db.js";

export interface SessionRow {
  id: string;
  user_id: number;
  profile_id: string;
  created_at: string;
  expires_at: string;
}

export class SessionsRepo {
  constructor(private readonly db: Db) {}

  create(userId: number, profileId: string, now: Date, ttlSeconds: number): string {
    const id = randomBytes(32).toString("hex");
    const expires = new Date(now.getTime() + ttlSeconds * 1000);
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, profile_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, userId, profileId, now.toISOString(), expires.toISOString());
    return id;
  }

  get(id: string, now: Date): SessionRow | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      | SessionRow
      | undefined;
    if (!row) return undefined;
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      this.destroy(id);
      return undefined;
    }
    return row;
  }

  destroy(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  destroyForUser(userId: number): void {
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }

  pruneExpired(now: Date): number {
    const result = this.db
      .prepare(`DELETE FROM sessions WHERE expires_at <= ?`)
      .run(now.toISOString());
    return result.changes;
  }
}
