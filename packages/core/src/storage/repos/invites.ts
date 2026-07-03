import type { Db } from "../db.js";

export type InvitePurpose = "signup" | "password_reset";

export interface InviteRow {
  id: number;
  token_hash: string;
  purpose: InvitePurpose;
  created_by: number;
  target_user_id: number | null;
  profile_id: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface InviteCreateInput {
  tokenHash: string;
  purpose: InvitePurpose;
  createdBy: number;
  targetUserId?: number | null;
  expiresAt: string;
}

export class InvitesRepo {
  constructor(private readonly db: Db) {}

  create(input: InviteCreateInput, now: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO invites (token_hash, purpose, created_by, target_user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.tokenHash,
        input.purpose,
        input.createdBy,
        input.targetUserId ?? null,
        input.expiresAt,
        now,
      );
    return Number(result.lastInsertRowid);
  }

  /** An unconsumed, unexpired invite matching this token hash, if any. */
  findValidByTokenHash(tokenHash: string, now: string): InviteRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM invites WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .get(tokenHash, now) as InviteRow | undefined;
  }

  /** Marks an invite consumed. `profileId` records the profile created at redemption (signup only). */
  consume(id: number, profileId: string | null, now: string): void {
    this.db
      .prepare(`UPDATE invites SET consumed_at = ?, profile_id = COALESCE(?, profile_id) WHERE id = ?`)
      .run(now, profileId, id);
  }
}
