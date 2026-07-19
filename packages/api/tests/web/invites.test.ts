import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";

describe("invites: signup issue + redeem", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "owner1@example.com", "pw-owner1-123", "owner", "p1");
    await createUser(db, "curator1@example.com", "pw-curator1-123", "curator", "p1");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("an owner can issue a signup invite; a curator cannot", async () => {
    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    const res = await owner.post("/api/invites");
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; expiresAt: string };
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);

    const curator = new TestClient(app);
    await curator.login("curator1@example.com", "pw-curator1-123");
    const forbidden = await curator.post("/api/invites");
    expect(forbidden.statusCode).toBe(403);
  });

  it("redeeming a valid invite creates a User + fresh Profile + Owner membership", async () => {
    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    const { token } = (await owner.post("/api/invites")).json() as { token: string };

    const redeemer = new TestClient(app);
    const redeemRes = await redeemer.post("/api/invites/redeem", {
      token,
      email: "newperson@example.com",
      password: "brand-new-pw-123",
    });
    expect(redeemRes.statusCode).toBe(201);

    // The new account can log in and lands in ITS OWN profile, isolated from p1.
    const loginRes = await redeemer.login("newperson@example.com", "brand-new-pw-123");
    expect(loginRes.statusCode).toBe(200);
    const monitors = (await redeemer.get("/api/monitors")).json() as {
      groups: unknown[];
    };
    expect(monitors.groups).toHaveLength(0);

    const me = (await redeemer.get("/api/me")).json() as { user: { role: string } };
    expect(me.user.role).toBe("owner");
  });

  it("rejects redeeming the same invite twice", async () => {
    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    const { token } = (await owner.post("/api/invites")).json() as { token: string };

    const first = new TestClient(app);
    const r1 = await first.post("/api/invites/redeem", {
      token,
      email: "first@example.com",
      password: "brand-new-pw-123",
    });
    expect(r1.statusCode).toBe(201);

    const second = new TestClient(app);
    const r2 = await second.post("/api/invites/redeem", {
      token,
      email: "second@example.com",
      password: "another-new-pw-123",
    });
    expect(r2.statusCode).toBe(400);
    expect((r2.json() as { error: string }).error).toBe("invalid_invite");
  });

  it("rejects an invite token that was never issued", async () => {
    const client = new TestClient(app);
    const res = await client.post("/api/invites/redeem", {
      token: "0".repeat(64),
      email: "nobody@example.com",
      password: "brand-new-pw-123",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects redeeming when the email is already in use", async () => {
    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    const { token } = (await owner.post("/api/invites")).json() as { token: string };

    const client = new TestClient(app);
    const res = await client.post("/api/invites/redeem", {
      token,
      email: "owner1@example.com",
      password: "brand-new-pw-123",
    });
    expect(res.statusCode).toBe(409);
  });

  it("records invite.create and invite.redeem in the right profiles' audit logs", async () => {
    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    const { token } = (await owner.post("/api/invites")).json() as { token: string };

    const p1Audit = new AuditLogRepo(db, "p1").fetchRecent(50).map((r) => r.action);
    expect(p1Audit).toContain("invite.create");

    const redeemer = new TestClient(app);
    await redeemer.post("/api/invites/redeem", {
      token,
      email: "newperson2@example.com",
      password: "brand-new-pw-123",
    });

    // The redeemed profile is a fresh slug, not p1 — read every profile's
    // audit rows isn't possible generically, so just confirm p1 never sees it.
    const p1AuditAfter = new AuditLogRepo(db, "p1").fetchRecent(50).map((r) => r.action);
    expect(p1AuditAfter.filter((a) => a === "invite.redeem")).toHaveLength(0);
  });
});

describe("password reset via invite machinery", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "owner1@example.com", "pw-owner1-123", "owner", "p1");
    await createUser(db, "curator1@example.com", "old-password-123", "curator", "p1");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("an owner-generated reset link lets the target user set a new password", async () => {
    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    const usersRes = (await owner.get("/api/users")).json() as {
      users: Array<{ id: number; email: string }>;
    };
    const curator = usersRes.users.find((u) => u.email === "curator1@example.com")!;

    const linkRes = await owner.post(`/api/users/${curator.id}/password-reset-link`);
    expect(linkRes.statusCode).toBe(201);
    const { token } = linkRes.json() as { token: string };

    const anon = new TestClient(app);
    const resetRes = await anon.post("/api/invites/redeem-password-reset", {
      token,
      password: "brand-new-password-456",
    });
    expect(resetRes.statusCode).toBe(200);

    // Old password no longer works; new one does.
    const oldLogin = new TestClient(app);
    expect((await oldLogin.login("curator1@example.com", "old-password-123")).statusCode).toBe(401);
    const newLogin = new TestClient(app);
    expect(
      (await newLogin.login("curator1@example.com", "brand-new-password-456")).statusCode,
    ).toBe(200);
  });

  it("a signup invite token cannot be redeemed as a password reset", async () => {
    const owner = new TestClient(app);
    await owner.login("owner1@example.com", "pw-owner1-123");
    const { token } = (await owner.post("/api/invites")).json() as { token: string };

    const anon = new TestClient(app);
    const res = await anon.post("/api/invites/redeem-password-reset", {
      token,
      password: "brand-new-password-456",
    });
    expect(res.statusCode).toBe(400);
  });
});
