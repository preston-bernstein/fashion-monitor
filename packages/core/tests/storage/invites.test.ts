import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Db } from "../../src/storage/db.js";
import { InvitesRepo } from "../../src/storage/repos/invites.js";
import { UsersRepo } from "../../src/storage/repos/users.js";
import { createMemoryDb } from "../helpers/db.js";

describe("InvitesRepo", () => {
  let db: Db;
  let ownerId: number;

  beforeEach(() => {
    db = createMemoryDb().db;
    ownerId = new UsersRepo(db).create("owner@example.com", "hash", new Date().toISOString());
  });

  afterEach(() => {
    db.close();
  });

  it("creates a signup invite and finds it valid before expiry", () => {
    const repo = new InvitesRepo(db);
    const now = "2026-01-01T00:00:00.000Z";
    const id = repo.create(
      { tokenHash: "hash-1", purpose: "signup", createdBy: ownerId, expiresAt: "2026-01-08T00:00:00.000Z" },
      now,
    );

    expect(id).toBeGreaterThan(0);
    const found = repo.findValidByTokenHash("hash-1", now);
    expect(found?.purpose).toBe("signup");
    expect(found?.consumed_at).toBeNull();
    expect(found?.profile_id).toBeNull();
  });

  it("does not find an expired invite", () => {
    const repo = new InvitesRepo(db);
    repo.create(
      { tokenHash: "hash-2", purpose: "signup", createdBy: ownerId, expiresAt: "2026-01-01T00:00:00.000Z" },
      "2025-12-25T00:00:00.000Z",
    );

    expect(repo.findValidByTokenHash("hash-2", "2026-01-01T00:00:01.000Z")).toBeUndefined();
  });

  it("does not find a consumed invite", () => {
    const repo = new InvitesRepo(db);
    const now = "2026-01-01T00:00:00.000Z";
    const id = repo.create(
      { tokenHash: "hash-3", purpose: "signup", createdBy: ownerId, expiresAt: "2026-01-08T00:00:00.000Z" },
      now,
    );

    repo.consume(id, "new-profile", now);
    expect(repo.findValidByTokenHash("hash-3", now)).toBeUndefined();
  });

  it("consume records the profile id for a signup invite", () => {
    const repo = new InvitesRepo(db);
    const now = "2026-01-01T00:00:00.000Z";
    const id = repo.create(
      { tokenHash: "hash-4", purpose: "signup", createdBy: ownerId, expiresAt: "2026-01-08T00:00:00.000Z" },
      now,
    );
    repo.consume(id, "spouse-profile", now);

    const row = db.prepare(`SELECT * FROM invites WHERE id = ?`).get(id) as {
      consumed_at: string | null;
      profile_id: string | null;
    };
    expect(row.consumed_at).toBe(now);
    expect(row.profile_id).toBe("spouse-profile");
  });

  it("consume with a null profileId leaves any existing profile_id untouched (COALESCE)", () => {
    const repo = new InvitesRepo(db);
    const now = "2026-01-01T00:00:00.000Z";
    const id = repo.create(
      {
        tokenHash: "hash-5",
        purpose: "password_reset",
        createdBy: ownerId,
        targetUserId: ownerId,
        expiresAt: "2026-01-02T00:00:00.000Z",
      },
      now,
    );

    // Password-reset invites are never given a profile_id at creation.
    repo.consume(id, null, now);
    const row = db.prepare(`SELECT profile_id, consumed_at FROM invites WHERE id = ?`).get(id) as {
      profile_id: string | null;
      consumed_at: string | null;
    };
    expect(row.profile_id).toBeNull();
    expect(row.consumed_at).toBe(now);
  });

  it("a password-reset invite records target_user_id and defaults targetUserId to null when omitted", () => {
    const repo = new InvitesRepo(db);
    const now = "2026-01-01T00:00:00.000Z";
    repo.create(
      {
        tokenHash: "hash-6",
        purpose: "password_reset",
        createdBy: ownerId,
        targetUserId: ownerId,
        expiresAt: "2026-01-02T00:00:00.000Z",
      },
      now,
    );
    const found = repo.findValidByTokenHash("hash-6", now);
    expect(found?.target_user_id).toBe(ownerId);

    repo.create({ tokenHash: "hash-7", purpose: "signup", createdBy: ownerId, expiresAt: "2026-01-08T00:00:00.000Z" }, now);
    expect(repo.findValidByTokenHash("hash-7", now)?.target_user_id).toBeNull();
  });
});
