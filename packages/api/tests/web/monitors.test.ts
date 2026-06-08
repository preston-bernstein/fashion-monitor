import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { ScrapeQueriesRepo } from "@fm/core/storage/repos/scrape-queries.js";
import { ConfigRevisionsRepo } from "@fm/core/storage/repos/config-revisions.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";

describe("monitors CRUD (JSON API)", () => {
  let db: Db;
  let app: FastifyInstance;
  let client: TestClient;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "curator@example.com", "pw-curator-1", "curator");
    app = await buildTestApp(db);
    client = new TestClient(app);
    const login = await client.login("curator@example.com", "pw-curator-1");
    expect(login.statusCode).toBe(200);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("creates, lists, edits, and deletes a monitor", async () => {
    const repo = new ScrapeQueriesRepo(db, "default");

    const create = await client.post("/api/monitors", {
      id: "grailed-knit",
      platform: "grailed",
      query_text: "wool textured knit",
      status: "active",
      enabled: true,
      note: "from test",
    });
    expect(create.statusCode).toBe(201);
    expect((create.json() as { monitor: { id: string } }).monitor.id).toBe("grailed-knit");

    const created = repo.getMonitor("grailed-knit");
    expect(created?.query_text).toBe("wool textured knit");
    expect(created?.platform).toBe("grailed");

    // Side effect: a config revision snapshot is recorded.
    expect(new ConfigRevisionsRepo(db, "default").fetchRecent(5).length).toBeGreaterThanOrEqual(1);

    const list = await client.get("/api/monitors");
    expect(list.statusCode).toBe(200);
    const body = list.json() as { monitors: { id: string }[]; canWrite: boolean };
    expect(body.canWrite).toBe(true);
    expect(body.monitors.some((m) => m.id === "grailed-knit")).toBe(true);

    // Edit: pause + change query.
    const edit = await client.patch("/api/monitors/grailed-knit", {
      status: "paused",
      enabled: false,
      query_text: "wool knit updated",
    });
    expect(edit.statusCode).toBe(200);
    const edited = repo.getMonitor("grailed-knit");
    expect(edited?.status).toBe("paused");
    expect(edited?.enabled).toBe(0);
    expect(edited?.query_text).toBe("wool knit updated");

    const del = await client.del("/api/monitors/grailed-knit");
    expect(del.statusCode).toBe(200);
    expect(repo.getMonitor("grailed-knit")).toBeUndefined();
  });

  it("rejects invalid monitor input and duplicates", async () => {
    const bad = await client.post("/api/monitors", {
      id: "bad id with spaces",
      platform: "ebay",
      query_text: "x",
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toBe("invalid_input");

    await client.post("/api/monitors", {
      id: "dupe",
      platform: "ebay",
      query_text: "first",
      status: "active",
      enabled: true,
    });
    const dupe = await client.post("/api/monitors", {
      id: "dupe",
      platform: "ebay",
      query_text: "second",
      status: "active",
      enabled: true,
    });
    expect(dupe.statusCode).toBe(409);
    expect((dupe.json() as { error: string }).error).toBe("duplicate");
  });

  it("returns 404 when editing or deleting a missing monitor", async () => {
    expect((await client.patch("/api/monitors/nope", { status: "paused" })).statusCode).toBe(404);
    expect((await client.del("/api/monitors/nope")).statusCode).toBe(404);
  });
});
