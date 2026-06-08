import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { buildTestApp, seedAdmin, TestClient } from "../helpers/web.js";

describe("audit list filters", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await seedAdmin(db);
    app = await buildTestApp(db);
    const audit = new AuditLogRepo(db, "default");
    const ts = "2026-01-01T12:00:00.000Z";
    audit.recordFromRequest(
      { userId: 1, actorEmail: "admin@example.com" },
      "search_group.create",
      ts,
      { target: "ebay-jacket", detail: { requestId: "r1" } },
    );
    audit.recordFromRequest(
      { userId: 1, actorEmail: "admin@example.com" },
      "user.create",
      "2026-01-02T12:00:00.000Z",
      { target: "curator@example.com", detail: { role: "curator" } },
    );
    audit.recordFromRequest(
      { userId: 2, actorEmail: "curator@example.com" },
      "auth.forbidden",
      "2026-01-03T12:00:00.000Z",
      { detail: { capability: "secrets:write" } },
    );
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns pagination metadata", async () => {
    const client = new TestClient(app);
    await client.login("admin@example.com", "admin-password-123");

    const res = await client.get("/api/audit?limit=2&offset=0");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: unknown[];
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
    };
    expect(body.total).toBe(4);
    expect(body.entries).toHaveLength(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.has_more).toBe(true);

    const page2 = await client.get("/api/audit?limit=2&offset=2");
    const body2 = page2.json() as { entries: unknown[]; has_more: boolean };
    expect(body2.entries).toHaveLength(2);
    expect(body2.has_more).toBe(false);
  });

  it("filters by category and actor", async () => {
    const client = new TestClient(app);
    await client.login("admin@example.com", "admin-password-123");

    const monitors = await client.get("/api/audit?category=monitors");
    expect(monitors.statusCode).toBe(200);
    const monitorBody = monitors.json() as { entries: { action: string }[]; total: number };
    expect(monitorBody.total).toBe(1);
    expect(monitorBody.entries[0]?.action).toBe("search_group.create");

    const actor = await client.get("/api/audit?actor=curator@example.com");
    const actorBody = actor.json() as { entries: { actor_email: string }[]; total: number };
    expect(actorBody.total).toBe(1);
    expect(actorBody.entries[0]?.actor_email).toBe("curator@example.com");
  });

  it("rejects invalid since", async () => {
    const client = new TestClient(app);
    await client.login("admin@example.com", "admin-password-123");
    const res = await client.get("/api/audit?since=not-a-date");
    expect(res.statusCode).toBe(400);
  });
});

describe("audit repo filters", () => {
  it("filters by action prefix and since", () => {
    const db = openDatabase(":memory:");
    const audit = new AuditLogRepo(db, "default");
    audit.recordFromRequest(
      { userId: 1, actorEmail: "a@x.com" },
      "search_group.update",
      "2026-02-01T00:00:00.000Z",
      {},
    );
    audit.recordFromRequest(
      { userId: 1, actorEmail: "a@x.com" },
      "search_group.delete",
      "2026-03-01T00:00:00.000Z",
      {},
    );
    audit.recordFromRequest(
      { userId: 1, actorEmail: "b@x.com" },
      "user.create",
      "2026-03-02T00:00:00.000Z",
      {},
    );

    const filtered = audit.fetchFiltered({
      actionPrefix: "search_group.",
      since: "2026-02-15T00:00:00.000Z",
    });
    expect(filtered.total).toBe(1);
    expect(filtered.entries[0]?.action).toBe("search_group.delete");
    db.close();
  });
});
