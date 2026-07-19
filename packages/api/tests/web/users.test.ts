import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { UsersRepo } from "@fm/core/storage/repos/users.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";

describe("user management routes", () => {
  let db: Db;
  let app: FastifyInstance;
  let owner: TestClient;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "owner@example.com", "pw-owner-123", "owner");
    app = await buildTestApp(db);
    owner = new TestClient(app);
    await owner.login("owner@example.com", "pw-owner-123");
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe("POST /api/users", () => {
    it("rejects creating a user with an email that's already taken", async () => {
      await owner.post("/api/users", {
        email: "curator@example.com",
        password: "curator-password-1",
        role: "curator",
      });

      const res = await owner.post("/api/users", {
        email: "curator@example.com",
        password: "another-password-1",
        role: "viewer",
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe("duplicate");
    });

    it("records a user.create audit entry with the assigned role", async () => {
      await owner.post("/api/users", {
        email: "curator@example.com",
        password: "curator-password-1",
        role: "curator",
      });

      const audit = new AuditLogRepo(db, "default").fetchRecent(10);
      const entry = audit.find((a) => a.action === "user.create");
      expect(entry?.target).toBe("curator@example.com");
      expect(JSON.parse(entry!.detail!)).toMatchObject({ role: "curator" });
    });

    it("lists created users alongside the available roles", async () => {
      await owner.post("/api/users", {
        email: "curator@example.com",
        password: "curator-password-1",
        role: "curator",
      });

      const res = await owner.get("/api/users");
      const body = res.json() as {
        users: Array<{ email: string; role: string }>;
        roles: unknown[];
      };
      expect(
        body.users.some((u) => u.email === "curator@example.com" && u.role === "curator"),
      ).toBe(true);
      expect(body.roles.length).toBeGreaterThan(0);
    });
  });

  describe("PATCH /api/users/:id/role", () => {
    it("returns 404 for a user id that doesn't exist", async () => {
      const res = await owner.patch("/api/users/999999/role", { role: "viewer" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for a user with no membership on this profile", async () => {
      const otherProfileUserId = await createUser(
        db,
        "elsewhere@example.com",
        "pw-else-123",
        "owner",
        "p2",
      );
      const res = await owner.patch(`/api/users/${otherProfileUserId}/role`, { role: "viewer" });
      expect(res.statusCode).toBe(404);
    });

    it("changes a non-owner's role and destroys their sessions", async () => {
      await owner.post("/api/users", {
        email: "curator@example.com",
        password: "curator-password-1",
        role: "curator",
      });
      const curatorClient = new TestClient(app);
      await curatorClient.login("curator@example.com", "curator-password-1");
      const meRes = await curatorClient.get("/api/me");
      const curatorId = (meRes.json() as { user: { id: number } }).user.id;

      const patchRes = await owner.patch(`/api/users/${curatorId}/role`, { role: "operator" });
      expect(patchRes.statusCode).toBe(200);

      // Session was destroyed by the role change — the old cookie no longer authenticates.
      const staleMe = await curatorClient.get("/api/me");
      expect(staleMe.statusCode).toBe(401);

      const audit = new AuditLogRepo(db, "default").fetchRecent(10);
      const entry = audit.find((a) => a.action === "user.role");
      expect(entry?.target).toBe("curator@example.com");
      expect(JSON.parse(entry!.detail!)).toMatchObject({ role: "operator" });
    });

    it("allows demoting an owner when another owner still exists", async () => {
      await owner.post("/api/users", {
        email: "owner2@example.com",
        password: "owner2-password-1",
        role: "owner",
      });
      const owner2Id = new UsersRepo(db).findByEmail("owner2@example.com")!.id;

      const res = await owner.patch(`/api/users/${owner2Id}/role`, { role: "viewer" });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("PATCH /api/users/:id/status", () => {
    it("returns 404 for a user id that doesn't exist", async () => {
      const res = await owner.patch("/api/users/999999/status", { status: "disabled" });
      expect(res.statusCode).toBe(404);
    });

    it("disabling a user destroys their sessions and records an audit entry", async () => {
      await owner.post("/api/users", {
        email: "curator@example.com",
        password: "curator-password-1",
        role: "curator",
      });
      const curatorClient = new TestClient(app);
      await curatorClient.login("curator@example.com", "curator-password-1");
      const curatorId = ((await curatorClient.get("/api/me")).json() as { user: { id: number } })
        .user.id;

      const patchRes = await owner.patch(`/api/users/${curatorId}/status`, { status: "disabled" });
      expect(patchRes.statusCode).toBe(200);

      const staleMe = await curatorClient.get("/api/me");
      expect(staleMe.statusCode).toBe(401);

      const audit = new AuditLogRepo(db, "default").fetchRecent(10);
      const entry = audit.find((a) => a.action === "user.status");
      expect(entry?.target).toBe("curator@example.com");
      expect(JSON.parse(entry!.detail!)).toMatchObject({ status: "disabled" });
    });

    it("re-enabling a disabled user does not destroy sessions (there are none to destroy) and lets them log in again", async () => {
      const userId = await createUser(db, "curator@example.com", "pw-curator-123", "curator");
      await owner.patch(`/api/users/${userId}/status`, { status: "disabled" });

      const blockedLogin = await new TestClient(app).login("curator@example.com", "pw-curator-123");
      expect(blockedLogin.statusCode).toBe(401);

      const reenable = await owner.patch(`/api/users/${userId}/status`, { status: "active" });
      expect(reenable.statusCode).toBe(200);

      const allowedLogin = await new TestClient(app).login("curator@example.com", "pw-curator-123");
      expect(allowedLogin.statusCode).toBe(200);
    });
  });

  it("scopes GET /api/users to the caller's own profile", async () => {
    await createUser(db, "other-owner@example.com", "pw-other-123", "owner", "p2");
    const res = await owner.get("/api/users");
    const body = res.json() as { users: Array<{ email: string }> };
    expect(body.users.some((u) => u.email === "other-owner@example.com")).toBe(false);
  });
});
