import type { Db } from "../db.js";
import type { Role } from "@fm/shared/rbac.js";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  id: number;
  user_id: number;
  profile_id: string;
  role: Role;
  created_at: string;
}

export interface UserWithRole {
  id: number;
  email: string;
  status: string;
  role: Role;
}

export class UsersRepo {
  constructor(private readonly db: Db) {}

  countActive(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'active'`)
      .get() as { n: number };
    return row.n;
  }

  findByEmail(email: string): UserRow | undefined {
    return this.db.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).get(email) as
      | UserRow
      | undefined;
  }

  findById(id: number): UserRow | undefined {
    return this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  }

  create(email: string, passwordHash: string, now: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO users (email, password_hash, status, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?)`,
      )
      .run(email.trim(), passwordHash, now, now);
    return Number(result.lastInsertRowid);
  }

  updatePassword(id: number, passwordHash: string, now: string): void {
    this.db
      .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .run(passwordHash, now, id);
  }

  setStatus(id: number, status: string, now: string): void {
    this.db
      .prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, now, id);
  }

  listForProfile(profileId: string): UserWithRole[] {
    return this.db
      .prepare(
        `SELECT u.id, u.email, u.status, m.role
         FROM users u
         JOIN memberships m ON m.user_id = u.id
         WHERE m.profile_id = ?
         ORDER BY u.email`,
      )
      .all(profileId) as UserWithRole[];
  }
}

export class MembershipsRepo {
  constructor(private readonly db: Db) {}

  forUser(userId: number, profileId: string): MembershipRow | undefined {
    return this.db
      .prepare(`SELECT * FROM memberships WHERE user_id = ? AND profile_id = ?`)
      .get(userId, profileId) as MembershipRow | undefined;
  }

  /**
   * Every profile a user belongs to, most-recently-created first. Login uses
   * this to resolve which profile to sign into: v1 invites give each user
   * exactly one membership, so the common case is unambiguous. A user with
   * more than one (no current UI path creates this, but the schema is M:N)
   * signs into the most recent one — there's no profile-picker UI yet.
   */
  listForUser(userId: number): MembershipRow[] {
    return this.db
      .prepare(`SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as MembershipRow[];
  }

  upsert(userId: number, profileId: string, role: Role, now: string): void {
    this.db
      .prepare(
        `INSERT INTO memberships (user_id, profile_id, role, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, profile_id) DO UPDATE SET role = excluded.role`,
      )
      .run(userId, profileId, role, now);
  }

  remove(userId: number, profileId: string): void {
    this.db
      .prepare(`DELETE FROM memberships WHERE user_id = ? AND profile_id = ?`)
      .run(userId, profileId);
  }

  countOwners(profileId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.profile_id = ? AND m.role = 'owner' AND u.status = 'active'`,
      )
      .get(profileId) as { n: number };
    return row.n;
  }
}

export interface ProfileRow {
  id: string;
  name: string;
}

export class ProfilesRepo {
  constructor(private readonly db: Db) {}

  ensure(id: string, name: string, now: string): void {
    this.db
      .prepare(
        `INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, name, now);
  }

  exists(id: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM profiles WHERE id = ?`).get(id);
    return row !== undefined;
  }

  /**
   * v1: every row in `profiles` is active — there is no status column yet.
   * Revisit if/when a profile lifecycle (suspended/deleted) is introduced.
   */
  list(): ProfileRow[] {
    return this.db.prepare(`SELECT id, name FROM profiles ORDER BY id`).all() as ProfileRow[];
  }
}
