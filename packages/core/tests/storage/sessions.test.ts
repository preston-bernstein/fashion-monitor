import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Db } from "../../src/storage/db.js";
import { SessionsRepo } from "../../src/storage/repos/sessions.js";
import { UsersRepo } from "../../src/storage/repos/users.js";
import { createMemoryDb } from "../helpers/db.js";

describe("SessionsRepo", () => {
  let db: Db;
  let userId: number;

  beforeEach(() => {
    db = createMemoryDb().db;
    userId = new UsersRepo(db).create("owner@example.com", "hash", new Date().toISOString());
  });

  afterEach(() => {
    db.close();
  });

  it("creates a session and reads it back before expiry", () => {
    const repo = new SessionsRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const id = repo.create(userId, "default", now, 3600);

    expect(id).toHaveLength(64);
    const row = repo.get(id, new Date("2026-01-01T00:30:00.000Z"));
    expect(row?.user_id).toBe(userId);
    expect(row?.profile_id).toBe("default");
    expect(row?.expires_at).toBe(new Date("2026-01-01T01:00:00.000Z").toISOString());
  });

  it("returns undefined and deletes the row once expired", () => {
    const repo = new SessionsRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const id = repo.create(userId, "default", now, 60);

    const afterExpiry = new Date("2026-01-01T00:01:01.000Z");
    expect(repo.get(id, afterExpiry)).toBeUndefined();
    // Lazily deleted on the expired read — a second lookup finds nothing to delete either.
    expect(repo.get(id, afterExpiry)).toBeUndefined();
  });

  it("returns undefined for an unknown session id", () => {
    const repo = new SessionsRepo(db);
    expect(repo.get("nonexistent", new Date())).toBeUndefined();
  });

  it("destroy removes a single session", () => {
    const repo = new SessionsRepo(db);
    const now = new Date();
    const id = repo.create(userId, "default", now, 3600);
    repo.destroy(id);
    expect(repo.get(id, now)).toBeUndefined();
  });

  it("destroyForUser removes every session for that user but not others'", () => {
    const repo = new SessionsRepo(db);
    const otherUserId = new UsersRepo(db).create(
      "other@example.com",
      "hash",
      new Date().toISOString(),
    );
    const now = new Date();

    const id1 = repo.create(userId, "default", now, 3600);
    const id2 = repo.create(userId, "default", now, 3600);
    const otherId = repo.create(otherUserId, "default", now, 3600);

    repo.destroyForUser(userId);

    expect(repo.get(id1, now)).toBeUndefined();
    expect(repo.get(id2, now)).toBeUndefined();
    expect(repo.get(otherId, now)).toBeDefined();
  });

  it("pruneExpired deletes only expired rows and reports the count", () => {
    const repo = new SessionsRepo(db);
    repo.create(userId, "default", new Date("2026-01-01T00:00:00.000Z"), 60);
    repo.create(userId, "default", new Date("2026-01-01T00:00:00.000Z"), 60);
    const liveId = repo.create(userId, "default", new Date("2026-01-01T00:00:00.000Z"), 86_400);

    const deleted = repo.pruneExpired(new Date("2026-01-01T00:05:00.000Z"));
    expect(deleted).toBe(2);
    expect(repo.get(liveId, new Date("2026-01-01T00:05:00.000Z"))).toBeDefined();
  });
});
