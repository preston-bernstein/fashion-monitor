import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { buildTestApp, seedAdmin, TestClient } from "../helpers/web.js";

describe("web auth (JSON API)", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await seedAdmin(db, "admin@example.com", "admin-password-1");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("rejects unauthenticated API access with 401 JSON (no redirect)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 from /api/me when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("serves the SPA shell (not a redirect) for client routes", async () => {
    const res = await app.inject({ method: "GET", url: "/monitors" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("exposes a CSRF token publicly", async () => {
    const res = await app.inject({ method: "GET", url: "/api/csrf" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { csrfToken: string }).csrfToken).toBeTruthy();
  });

  it("logs in with valid credentials and rejects invalid ones", async () => {
    const bad = new TestClient(app);
    const badRes = await bad.login("admin@example.com", "wrong-password");
    expect(badRes.statusCode).toBe(401);
    expect(badRes.json()).toEqual({ error: "invalid_credentials" });

    const noUser = new TestClient(app);
    const noUserRes = await noUser.login("nobody@example.com", "whatever");
    expect(noUserRes.statusCode).toBe(401);

    const good = new TestClient(app);
    const goodRes = await good.login("admin@example.com", "admin-password-1");
    expect(goodRes.statusCode).toBe(200);
    const body = goodRes.json() as {
      user: { email: string; role: string };
      capabilities: string[];
    };
    expect(body.user.email).toBe("admin@example.com");
    expect(body.user.role).toBe("owner");
    expect(body.capabilities).toContain("users:manage");

    const me = await good.get("/api/me");
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe("admin@example.com");

    const dash = await good.get("/api/dashboard");
    expect(dash.statusCode).toBe(200);
  });

  it("rejects login POST without a CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "admin@example.com", password: "admin-password-1" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("logs out and invalidates the session", async () => {
    const client = new TestClient(app);
    await client.login("admin@example.com", "admin-password-1");
    expect((await client.get("/api/dashboard")).statusCode).toBe(200);

    const out = await client.logout();
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({ ok: true });

    expect((await client.get("/api/dashboard")).statusCode).toBe(401);
  });
});
