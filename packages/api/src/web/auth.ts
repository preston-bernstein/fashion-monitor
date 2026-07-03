import argon2 from "argon2";
import type { Db } from "@fm/core/storage/db.js";
import type { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { UsersRepo, MembershipsRepo, ProfilesRepo } from "@fm/core/storage/repos/users.js";
import type { Role } from "./rbac.js";
import { isRole } from "./rbac.js";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export interface AuthenticatedUser {
  id: number;
  email: string;
  role: Role;
}

/**
 * Verify email + password against an active user with a membership in the profile.
 * Returns the user (with profile role) or null. Always runs an argon2 verify
 * against a real dummy hash when the user is missing to reduce timing leak.
 */
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("not-a-real-password");
  return dummyHashPromise;
}

export async function authenticate(
  db: Db,
  profileId: string,
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const users = new UsersRepo(db);
  const memberships = new MembershipsRepo(db);
  const user = users.findByEmail(email);

  if (!user || user.status !== "active") {
    await verifyPassword(await getDummyHash(), password);
    return null;
  }

  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) return null;

  const membership = memberships.forUser(user.id, profileId);
  if (!membership) return null;

  return { id: user.id, email: user.email, role: membership.role };
}

/**
 * Idempotently ensure an admin (owner) exists. Creates the user from
 * ADMIN_EMAIL/ADMIN_PASSWORD-style inputs if absent; grants owner membership.
 */
export interface BootstrapResult {
  userId: number;
  created: boolean;
}

export async function bootstrapAdmin(
  db: Db,
  profileId: string,
  email: string,
  password: string,
  now: string,
  role: Role = "owner",
): Promise<BootstrapResult> {
  const users = new UsersRepo(db);
  const memberships = new MembershipsRepo(db);
  new ProfilesRepo(db).ensure(profileId, profileId, now);

  const user = users.findByEmail(email);
  let userId: number;
  let created = false;
  if (!user) {
    userId = users.create(email, await hashPassword(password), now);
    created = true;
  } else {
    userId = user.id;
    if (user.status !== "active") users.setStatus(userId, "active", now);
  }
  memberships.upsert(userId, profileId, role, now);
  return { userId, created };
}

export interface AdminEnv {
  email?: string;
  password?: string;
}

/**
 * Resolve admin bootstrap credentials from env and, if present, seed them.
 * Throws if the system has no admin and none can be created (refuse to start
 * internet-exposed with no admin).
 */
export async function ensureAdmin(
  db: Db,
  profileId: string,
  env: AdminEnv,
  now: string,
  audit?: AuditLogRepo,
): Promise<void> {
  const memberships = new MembershipsRepo(db);
  const hasOwner = memberships.countOwners(profileId) > 0;

  if (env.email && env.password) {
    const role: Role = "owner";
    const { userId, created } = await bootstrapAdmin(
      db,
      profileId,
      env.email,
      env.password,
      now,
      role,
    );
    if (created && audit) {
      audit.recordFromRequest({ userId, actorEmail: env.email }, "system.bootstrap.admin", now, {
        target: env.email,
        detail: { role },
      });
    }
    return;
  }

  if (!hasOwner) {
    throw new Error(
      "No admin user exists. Set ADMIN_EMAIL and ADMIN_PASSWORD to bootstrap the first owner.",
    );
  }
}

export function parseRoleOrThrow(value: string): Role {
  if (!isRole(value)) throw new Error(`Invalid role: ${value}`);
  return value;
}
