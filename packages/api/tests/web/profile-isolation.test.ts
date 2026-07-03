import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";

/**
 * One server instance now serves every profile in the DB (see app.ts's
 * per-request profileId resolution). These tests are the regression gate for
 * that change: two owners of two different profiles, logged in against the
 * SAME running app, must never see or affect each other's data through any
 * route — this is the exact failure mode a missed `ctx.profileId` -> `req.profileId`
 * call site would produce.
 */
describe("web API cross-profile isolation", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "owner1@example.com", "pw-owner1-123", "owner", "p1");
    await createUser(db, "owner2@example.com", "pw-owner2-123", "owner", "p2");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("logs each owner into their OWN profile, not a fixed one", async () => {
    const c1 = new TestClient(app);
    await c1.login("owner1@example.com", "pw-owner1-123");
    const me1 = (await c1.get("/api/me")).json() as { user: { email: string } };
    expect(me1.user.email).toBe("owner1@example.com");

    const c2 = new TestClient(app);
    await c2.login("owner2@example.com", "pw-owner2-123");
    const me2 = (await c2.get("/api/me")).json() as { user: { email: string } };
    expect(me2.user.email).toBe("owner2@example.com");
  });

  it("a Monitor created by owner1 is invisible to owner2, and vice versa", async () => {
    const c1 = new TestClient(app);
    await c1.login("owner1@example.com", "pw-owner1-123");
    const created = await c1.post("/api/monitors", {
      id: "p1-only-monitor",
      query_text: "p1's query",
      status: "active",
      enabled: true,
    });
    expect(created.statusCode).toBe(201);

    const c2 = new TestClient(app);
    await c2.login("owner2@example.com", "pw-owner2-123");
    const list2 = (await c2.get("/api/monitors")).json() as { groups: Array<{ id: string }> };
    expect(list2.groups.find((g) => g.id === "p1-only-monitor")).toBeUndefined();
    expect(list2.groups).toHaveLength(0);

    const list1 = (await c1.get("/api/monitors")).json() as { groups: Array<{ id: string }> };
    expect(list1.groups.map((g) => g.id)).toEqual(["p1-only-monitor"]);
  });

  it("the SAME Monitor id can be created independently in two profiles without collision", async () => {
    const c1 = new TestClient(app);
    await c1.login("owner1@example.com", "pw-owner1-123");
    const r1 = await c1.post("/api/monitors", {
      id: "shared-id",
      query_text: "p1's query",
      status: "active",
      enabled: true,
    });
    expect(r1.statusCode).toBe(201);

    const c2 = new TestClient(app);
    await c2.login("owner2@example.com", "pw-owner2-123");
    const r2 = await c2.post("/api/monitors", {
      id: "shared-id",
      query_text: "p2's query",
      status: "active",
      enabled: true,
    });
    expect(r2.statusCode).toBe(201);

    const list1 = (await c1.get("/api/monitors")).json() as {
      groups: Array<{ id: string; query_text: string }>;
    };
    const list2 = (await c2.get("/api/monitors")).json() as {
      groups: Array<{ id: string; query_text: string }>;
    };
    expect(list1.groups[0].query_text).toBe("p1's query");
    expect(list2.groups[0].query_text).toBe("p2's query");
  });

  it("Taste set by owner1 does not leak into owner2's /api/taste", async () => {
    const c1 = new TestClient(app);
    await c1.login("owner1@example.com", "pw-owner1-123");
    const put = await c1.put("/api/taste", {
      aesthetic_prompt: "p1's secret aesthetic",
      hard_no: [],
      positive_signals: { strong: [], weak: [] },
      price_ceiling: { default: 100 },
      measurements: {},
    });
    expect(put.statusCode).toBe(200);

    const c2 = new TestClient(app);
    await c2.login("owner2@example.com", "pw-owner2-123");
    const taste2 = (await c2.get("/api/taste")).json() as { taste: { aesthetic_prompt: string } };
    expect(taste2.taste.aesthetic_prompt).not.toBe("p1's secret aesthetic");
    expect(taste2.taste.aesthetic_prompt).toBe("");
  });

  it("audit entries from owner1's actions never appear in owner2's /api/audit", async () => {
    const c1 = new TestClient(app);
    await c1.login("owner1@example.com", "pw-owner1-123");
    await c1.post("/api/monitors", {
      id: "audited-monitor",
      query_text: "p1's query",
      status: "active",
      enabled: true,
    });

    const c2 = new TestClient(app);
    await c2.login("owner2@example.com", "pw-owner2-123");
    const audit2 = (await c2.get("/api/audit")).json() as {
      entries: Array<{ action: string; target: string | null }>;
    };
    expect(
      audit2.entries.find(
        (e) => e.action === "search_group.create" && e.target === "audited-monitor",
      ),
    ).toBeUndefined();
  });

  it("owner2 cannot manage owner1's users through /api/users", async () => {
    const c1 = new TestClient(app);
    await c1.login("owner1@example.com", "pw-owner1-123");
    const users1 = (await c1.get("/api/users")).json() as { users: Array<{ email: string }> };
    expect(users1.users.map((u) => u.email)).toEqual(["owner1@example.com"]);

    const c2 = new TestClient(app);
    await c2.login("owner2@example.com", "pw-owner2-123");
    const users2 = (await c2.get("/api/users")).json() as { users: Array<{ email: string }> };
    expect(users2.users.map((u) => u.email)).toEqual(["owner2@example.com"]);
  });
});
