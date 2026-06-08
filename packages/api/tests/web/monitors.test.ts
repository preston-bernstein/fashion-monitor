import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { SearchGroupsRepo, executionId } from "@fm/core/storage/repos/search-groups.js";
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

  it("creates a search group with platform executions", async () => {
    const groups = new SearchGroupsRepo(db, "default");

    const create = await client.post("/api/monitors", {
      id: "corduroy-jacket",
      query_text: "men corduroy jacket",
      platforms: ["ebay", "depop", "grailed"],
      status: "active",
      enabled: true,
      note: "from test",
    });
    expect(create.statusCode).toBe(201);
    const body = create.json() as { group: { id: string; executions: { id: string }[] } };
    expect(body.group.id).toBe("corduroy-jacket");
    expect(body.group.executions).toHaveLength(3);

    const executions = groups.listExecutions("corduroy-jacket");
    expect(executions).toHaveLength(3);
    expect(executions.map((e) => e.id).sort()).toEqual(
      [
        executionId("corduroy-jacket", "depop"),
        executionId("corduroy-jacket", "ebay"),
        executionId("corduroy-jacket", "grailed"),
      ].sort(),
    );

    expect(new ConfigRevisionsRepo(db, "default").fetchRecent(5).length).toBeGreaterThanOrEqual(1);

    const list = await client.get("/api/monitors");
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as {
      groups: { id: string }[];
      canWrite: boolean;
    };
    expect(listBody.canWrite).toBe(true);
    expect(listBody.groups.some((g) => g.id === "corduroy-jacket")).toBe(true);
    expect(listBody.groups).toHaveLength(1);
  });

  it("lists, edits, and deletes a search group", async () => {
    const groups = new SearchGroupsRepo(db, "default");

    const create = await client.post("/api/monitors", {
      id: "grailed-knit",
      query_text: "wool textured knit",
      platforms: ["grailed"],
      status: "active",
      enabled: true,
      note: "from test",
    });
    expect(create.statusCode).toBe(201);
    expect((create.json() as { group: { id: string } }).group.id).toBe("grailed-knit");

    const created = groups.getGroup("grailed-knit");
    expect(created?.query_text).toBe("wool textured knit");
    expect(groups.listExecutions("grailed-knit")[0]?.group_id).toBe("grailed-knit");

    const list = await client.get("/api/monitors");
    const body = list.json() as { groups: { id: string }[] };
    expect(body.groups.some((g) => g.id === "grailed-knit")).toBe(true);

    const edit = await client.patch("/api/monitors/grailed-knit", {
      status: "paused",
      enabled: false,
      query_text: "wool knit updated",
    });
    expect(edit.statusCode).toBe(200);
    const edited = groups.getGroup("grailed-knit");
    expect(edited?.status).toBe("paused");
    expect(edited?.enabled).toBe(0);

    const del = await client.del("/api/monitors/grailed-knit");
    expect(del.statusCode).toBe(200);
    expect(groups.getGroup("grailed-knit")).toBeUndefined();
  });

  it("rejects invalid monitor input and duplicates", async () => {
    const bad = await client.post("/api/monitors", {
      id: "bad id with spaces",
      query_text: "x",
      platforms: ["ebay"],
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toBe("invalid_input");

    await client.post("/api/monitors", {
      id: "dupe",
      query_text: "first",
      platforms: ["ebay"],
      status: "active",
      enabled: true,
    });
    const dupe = await client.post("/api/monitors", {
      id: "dupe",
      query_text: "second",
      platforms: ["depop"],
      status: "active",
      enabled: true,
    });
    expect(dupe.statusCode).toBe(409);
    expect((dupe.json() as { error: string }).error).toBe("duplicate");
  });

  it("updates platforms and syncs executions", async () => {
    const groups = new SearchGroupsRepo(db, "default");

    await client.post("/api/monitors", {
      id: "multi-platform",
      query_text: "vintage jacket",
      platforms: ["ebay"],
      status: "active",
      enabled: true,
    });

    const patch = await client.patch("/api/monitors/multi-platform", {
      platforms: ["ebay", "depop", "grailed"],
    });
    expect(patch.statusCode).toBe(200);

    const updated = groups.getGroup("multi-platform");
    expect(updated?.platforms).toEqual(["ebay", "depop", "grailed"]);
    expect(groups.listExecutions("multi-platform")).toHaveLength(3);
  });

  it("returns 404 when editing or deleting a missing monitor", async () => {
    expect((await client.patch("/api/monitors/nope", { status: "paused" })).statusCode).toBe(404);
    expect((await client.del("/api/monitors/nope")).statusCode).toBe(404);
  });
});
