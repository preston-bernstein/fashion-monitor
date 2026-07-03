import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { ProfilesRepo } from "@fm/core/storage/repos/users.js";
import { SearchGroupsRepo } from "@fm/core/storage/repos/search-groups.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";

describe("DELETE /api/profile", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    new ProfilesRepo(db).ensure("p1", "p1", new Date().toISOString());
    await createUser(db, "owner1@example.com", "pw-owner1-123", "owner", "p1");
    await createUser(db, "admin1@example.com", "pw-admin1-123", "admin", "p1");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("an admin (not owner) cannot delete the profile", async () => {
    const admin = new TestClient(app);
    await admin.login("admin1@example.com", "pw-admin1-123");
    const res = await admin.del("/api/profile");
    expect(res.statusCode).toBe(403);
    expect(new ProfilesRepo(db).exists("p1")).toBe(true);
  });

  it("the owner can delete their own profile, cascading Monitors, users, and sessions", async () => {
    new SearchGroupsRepo(db, "p1").createGroup(
      {
        id: "will-be-deleted",
        query_text: "q",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      new Date().toISOString(),
    );

    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    const res = await owner.del("/api/profile");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; rowsDeleted: number };
    expect(body.ok).toBe(true);
    expect(body.rowsDeleted).toBeGreaterThan(0);

    expect(new ProfilesRepo(db).exists("p1")).toBe(false);
    expect(new SearchGroupsRepo(db, "p1").listGroups()).toHaveLength(0);

    // The deleted profile's own audit_log is gone with it, but the request
    // itself needed no further auth — the session cookie is now dead.
    const me = await owner.get("/api/me");
    expect(me.statusCode).toBe(401);
  });

  it("writes a final audit record to the system profile that outlives the deleted profile", async () => {
    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    await owner.del("/api/profile");

    const systemAudit = new AuditLogRepo(db, "default").fetchRecent(50);
    const entry = systemAudit.find((e) => e.action === "profile.delete");
    expect(entry).toBeTruthy();
    expect(entry?.target).toBe("p1");
  });

  it("does not affect a different profile's data", async () => {
    new ProfilesRepo(db).ensure("p2", "p2", new Date().toISOString());
    await createUser(db, "owner2@example.com", "pw-owner2-123", "owner", "p2");
    new SearchGroupsRepo(db, "p2").createGroup(
      {
        id: "p2-survives",
        query_text: "q",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      new Date().toISOString(),
    );

    const owner1 = new TestClient(app);
    await owner1.login("owner1@example.com", "pw-owner1-123");
    await owner1.del("/api/profile");

    expect(new ProfilesRepo(db).exists("p2")).toBe(true);
    expect(new SearchGroupsRepo(db, "p2").listGroups()).toHaveLength(1);

    const owner2 = new TestClient(app);
    const login = await owner2.login("owner2@example.com", "pw-owner2-123");
    expect(login.statusCode).toBe(200);
  });
});
