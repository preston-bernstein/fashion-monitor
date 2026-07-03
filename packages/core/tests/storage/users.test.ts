import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Db } from "../../src/storage/db.js";
import { UsersRepo, MembershipsRepo, ProfilesRepo } from "../../src/storage/repos/users.js";
import { createMemoryDb } from "../helpers/db.js";

describe("UsersRepo", () => {
  let db: Db;

  beforeEach(() => {
    db = createMemoryDb().db;
  });

  afterEach(() => {
    db.close();
  });

  it("creates a user, trims the email, and finds it case-insensitively", () => {
    const repo = new UsersRepo(db);
    const now = new Date().toISOString();
    const id = repo.create("  Owner@Example.com  ", "hash", now);

    expect(repo.findByEmail("owner@example.com")?.id).toBe(id);
    expect(repo.findByEmail("OWNER@EXAMPLE.COM")?.id).toBe(id);
    expect(repo.findById(id)?.email).toBe("Owner@Example.com");
  });

  it("returns undefined for an unknown email or id", () => {
    const repo = new UsersRepo(db);
    expect(repo.findByEmail("nobody@example.com")).toBeUndefined();
    expect(repo.findById(999)).toBeUndefined();
  });

  it("new users default to active status", () => {
    const repo = new UsersRepo(db);
    const id = repo.create("owner@example.com", "hash", new Date().toISOString());
    expect(repo.findById(id)?.status).toBe("active");
  });

  it("countActive only counts active users", () => {
    const repo = new UsersRepo(db);
    const now = new Date().toISOString();
    const id1 = repo.create("a@example.com", "hash", now);
    repo.create("b@example.com", "hash", now);
    expect(repo.countActive()).toBe(2);

    repo.setStatus(id1, "disabled", now);
    expect(repo.countActive()).toBe(1);
  });

  it("updatePassword replaces the hash and bumps updated_at", () => {
    const repo = new UsersRepo(db);
    const id = repo.create("owner@example.com", "old-hash", "2026-01-01T00:00:00.000Z");
    repo.updatePassword(id, "new-hash", "2026-01-02T00:00:00.000Z");

    const row = repo.findById(id);
    expect(row?.password_hash).toBe("new-hash");
    expect(row?.updated_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("listForProfile returns each user's role for that profile only", () => {
    const users = new UsersRepo(db);
    const memberships = new MembershipsRepo(db);
    const now = new Date().toISOString();

    const owner = users.create("owner@example.com", "hash", now);
    const curator = users.create("curator@example.com", "hash", now);
    const otherProfileUser = users.create("elsewhere@example.com", "hash", now);

    memberships.upsert(owner, "p1", "owner", now);
    memberships.upsert(curator, "p1", "curator", now);
    memberships.upsert(otherProfileUser, "p2", "owner", now);

    const list = users.listForProfile("p1");
    expect(list).toHaveLength(2);
    expect(list.find((u) => u.email === "owner@example.com")?.role).toBe("owner");
    expect(list.find((u) => u.email === "curator@example.com")?.role).toBe("curator");
  });
});

describe("MembershipsRepo", () => {
  let db: Db;
  let userId: number;

  beforeEach(() => {
    db = createMemoryDb().db;
    userId = new UsersRepo(db).create("owner@example.com", "hash", new Date().toISOString());
  });

  afterEach(() => {
    db.close();
  });

  it("upsert creates a membership, and a second upsert updates the role instead of duplicating", () => {
    const repo = new MembershipsRepo(db);
    const now = new Date().toISOString();
    repo.upsert(userId, "default", "curator", now);
    repo.upsert(userId, "default", "owner", now);

    expect(repo.forUser(userId, "default")?.role).toBe("owner");
    expect(repo.listForUser(userId)).toHaveLength(1);
  });

  it("listForUser orders most-recently-created membership first", () => {
    const repo = new MembershipsRepo(db);
    repo.upsert(userId, "p1", "owner", "2026-01-01T00:00:00.000Z");
    repo.upsert(userId, "p2", "owner", "2026-01-02T00:00:00.000Z");

    const list = repo.listForUser(userId);
    expect(list.map((m) => m.profile_id)).toEqual(["p2", "p1"]);
  });

  it("remove deletes only the targeted membership", () => {
    const repo = new MembershipsRepo(db);
    const now = new Date().toISOString();
    repo.upsert(userId, "p1", "owner", now);
    repo.upsert(userId, "p2", "owner", now);

    repo.remove(userId, "p1");
    expect(repo.forUser(userId, "p1")).toBeUndefined();
    expect(repo.forUser(userId, "p2")).toBeDefined();
  });

  it("countOwners counts only active users with the owner role on that profile", () => {
    const users = new UsersRepo(db);
    const repo = new MembershipsRepo(db);
    const now = new Date().toISOString();

    const owner1 = users.create("owner1@example.com", "hash", now);
    const owner2Disabled = users.create("owner2@example.com", "hash", now);
    const curator = users.create("curator@example.com", "hash", now);

    repo.upsert(owner1, "default", "owner", now);
    repo.upsert(owner2Disabled, "default", "owner", now);
    repo.upsert(curator, "default", "curator", now);
    users.setStatus(owner2Disabled, "disabled", now);

    expect(repo.countOwners("default")).toBe(1);
  });
});

describe("ProfilesRepo", () => {
  let db: Db;

  beforeEach(() => {
    db = createMemoryDb().db;
  });

  afterEach(() => {
    db.close();
  });

  it("ensure is idempotent (ON CONFLICT DO NOTHING)", () => {
    const repo = new ProfilesRepo(db);
    const now = new Date().toISOString();
    repo.ensure("p1", "First name", now);
    repo.ensure("p1", "Different name, ignored", now);

    expect(repo.exists("p1")).toBe(true);
    const row = db.prepare(`SELECT name FROM profiles WHERE id = ?`).get("p1") as { name: string };
    expect(row.name).toBe("First name");
  });

  it("exists is false for an unknown profile", () => {
    const repo = new ProfilesRepo(db);
    expect(repo.exists("nope")).toBe(false);
  });

  it("list returns every profile ordered by id", () => {
    const repo = new ProfilesRepo(db);
    const now = new Date().toISOString();
    repo.ensure("zeta", "Zeta", now);
    repo.ensure("alpha", "Alpha", now);

    expect(repo.list().map((p) => p.id)).toEqual(["alpha", "zeta"]);
  });
});
