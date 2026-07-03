import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Db } from "../../src/storage/db.js";
import { deleteProfileCascade } from "../../src/storage/profile-deletion.js";
import { ProfilesRepo, UsersRepo, MembershipsRepo } from "../../src/storage/repos/users.js";
import { SearchGroupsRepo } from "../../src/storage/repos/search-groups.js";
import { RunsRepo } from "../../src/storage/repos/runs.js";
import { AuditLogRepo } from "../../src/storage/repos/audit-log.js";
import { InvitesRepo } from "../../src/storage/repos/invites.js";
import { SessionsRepo } from "../../src/storage/repos/sessions.js";
import { createMemoryDb } from "../helpers/db.js";

describe("deleteProfileCascade", () => {
  let db: Db;

  beforeEach(() => {
    db = createMemoryDb().db;
  });

  afterEach(() => {
    db.close();
  });

  it("removes profile-scoped rows, the profile row itself, but not the global users table", () => {
    const now = new Date().toISOString();
    const profiles = new ProfilesRepo(db);
    const users = new UsersRepo(db);
    const memberships = new MembershipsRepo(db);
    const groups = new SearchGroupsRepo(db, "p1");
    const runs = new RunsRepo(db, "p1");
    const audit = new AuditLogRepo(db, "p1");

    profiles.ensure("p1", "Deleting", now);
    const userId = users.create("spouse@example.com", "hash", now);
    memberships.upsert(userId, "p1", "owner", now);
    groups.createGroup(
      {
        id: "watch-1",
        query_text: "corduroy",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      now,
    );
    const runId = runs.start(now);
    runs.finish(
      runId,
      now,
      {
        listingsFound: 1,
        listingsNew: 1,
        prefilterRejected: 0,
        scoredYes: 1,
        scoredMaybe: 0,
        scoredNo: 0,
        alertsSent: 1,
        errors: [],
      },
      null,
    );
    audit.record({ userId, actorEmail: "spouse@example.com", action: "invite.redeem" }, now);

    const result = deleteProfileCascade(db, "p1");

    expect(result.profileId).toBe("p1");
    expect(result.rowsDeleted).toBeGreaterThan(0);
    expect(profiles.exists("p1")).toBe(false);
    expect(groups.getGroup("watch-1")).toBeUndefined();
    expect(runs.recentFunnel(10)).toHaveLength(0);
    expect(audit.fetchRecent(10)).toHaveLength(0);
    // Global identity survives — the user just loses this one membership row.
    expect(users.findById(userId)).toBeDefined();
    expect(memberships.forUser(userId, "p1")).toBeUndefined();
  });

  it("does not touch another profile's data", () => {
    const now = new Date().toISOString();
    const profiles = new ProfilesRepo(db);
    profiles.ensure("p1", "Deleting", now);
    profiles.ensure("p2", "Keeping", now);

    new SearchGroupsRepo(db, "p1").createGroup(
      {
        id: "watch-1",
        query_text: "corduroy",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      now,
    );
    new SearchGroupsRepo(db, "p2").createGroup(
      {
        id: "watch-2",
        query_text: "denim",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      now,
    );

    deleteProfileCascade(db, "p1");

    expect(profiles.exists("p1")).toBe(false);
    expect(profiles.exists("p2")).toBe(true);
    expect(new SearchGroupsRepo(db, "p2").getGroup("watch-2")).toBeDefined();
  });

  it("only removes consumed invites (profile_id set) for that profile, since pending invites have no profile_id yet", () => {
    const now = new Date().toISOString();
    const profiles = new ProfilesRepo(db);
    const users = new UsersRepo(db);
    const invites = new InvitesRepo(db);
    profiles.ensure("p1", "Deleting", now);
    const ownerId = users.create("owner@example.com", "hash", now);

    const consumedId = invites.create(
      { tokenHash: "consumed", purpose: "signup", createdBy: ownerId, expiresAt: "2026-02-01T00:00:00.000Z" },
      now,
    );
    invites.consume(consumedId, "p1", now);

    invites.create(
      { tokenHash: "pending", purpose: "signup", createdBy: ownerId, expiresAt: "2026-02-01T00:00:00.000Z" },
      now,
    );

    deleteProfileCascade(db, "p1");

    expect(db.prepare(`SELECT * FROM invites WHERE token_hash = 'consumed'`).get()).toBeUndefined();
    expect(db.prepare(`SELECT * FROM invites WHERE token_hash = 'pending'`).get()).toBeDefined();
  });

  it("removes sessions scoped to that profile", () => {
    const now = new Date();
    const users = new UsersRepo(db);
    const sessions = new SessionsRepo(db);
    const profiles = new ProfilesRepo(db);
    profiles.ensure("p1", "Deleting", now.toISOString());
    const userId = users.create("spouse@example.com", "hash", now.toISOString());

    const sessionId = sessions.create(userId, "p1", now, 3600);
    deleteProfileCascade(db, "p1");

    expect(sessions.get(sessionId, now)).toBeUndefined();
  });

  it("is a no-op (zero rows, no throw) for a profile that never existed", () => {
    const result = deleteProfileCascade(db, "never-existed");
    expect(result.rowsDeleted).toBe(0);
  });
});
