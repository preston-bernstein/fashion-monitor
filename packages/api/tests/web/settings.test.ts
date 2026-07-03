import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { ConfigRevisionsRepo } from "@fm/core/storage/repos/config-revisions.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";
import type { SystemResponse, TasteResponse } from "@fm/shared/dto.js";

const validTaste = {
  aesthetic_prompt: "Dark academic, natural fabrics.",
  hard_no: ["slim fit"],
  positive_signals: { strong: ["corduroy"], weak: ["tweed"] },
  price_ceiling: { default: 300, tops: 200 },
  measurements: { typical_size: "XXL" },
};

const validSystem = {
  platforms: { ebay: true, grailed: true },
  llm: { provider: "mock", batch_size: 15, ollama_text_model: "qwen2.5:7b", claude_model: "claude-haiku-4-5", vision_backend: "ollama" },
  alert_options: { mode: "immediate", notify_empty: false },
  scraper: { poshmark_profile_path: "data/poshmark-profile" },
};

describe("settings routes", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe("GET/PUT /api/taste", () => {
    it("returns empty defaults before anything is saved", async () => {
      await createUser(db, "owner@example.com", "pw-owner-123", "owner");
      const client = new TestClient(app);
      await client.login("owner@example.com", "pw-owner-123");

      const res = await client.get("/api/taste");
      expect(res.statusCode).toBe(200);
      const body = res.json() as TasteResponse;
      expect(body.taste.aesthetic_prompt).toBe("");
      expect(body.taste.hard_no).toEqual([]);
      expect(body.taste.price_ceiling).toEqual({ default: 0 });
      expect(body.canWrite).toBe(true);
    });

    it("reflects canWrite:false for a role with taste:read but not taste:write", async () => {
      await createUser(db, "operator@example.com", "pw-operator-123", "operator");
      const client = new TestClient(app);
      await client.login("operator@example.com", "pw-operator-123");

      const res = await client.get("/api/taste");
      expect(res.statusCode).toBe(200);
      expect((res.json() as TasteResponse).canWrite).toBe(false);
    });

    it("rejects an empty aesthetic_prompt", async () => {
      await createUser(db, "owner@example.com", "pw-owner-123", "owner");
      const client = new TestClient(app);
      await client.login("owner@example.com", "pw-owner-123");

      const res = await client.put("/api/taste", { ...validTaste, aesthetic_prompt: "  " });
      expect(res.statusCode).toBe(400);
    });

    it("persists all fields, records an audit entry with changed fields, and snapshots a config revision", async () => {
      const userId = await createUser(db, "owner@example.com", "pw-owner-123", "owner");
      const client = new TestClient(app);
      await client.login("owner@example.com", "pw-owner-123");

      const putRes = await client.put("/api/taste", validTaste);
      expect(putRes.statusCode).toBe(200);

      const getRes = await client.get("/api/taste");
      const body = getRes.json() as TasteResponse;
      expect(body.taste).toEqual(validTaste);

      const audit = new AuditLogRepo(db, "default").fetchRecent(10);
      const entry = audit.find((a) => a.action === "taste.update");
      expect(entry?.user_id).toBe(userId);
      const detail = JSON.parse(entry!.detail!) as { fields: string[] };
      expect(detail.fields.sort()).toEqual(
        ["aesthetic_prompt", "hard_no", "positive_signals", "price_ceiling", "measurements"].sort(),
      );

      const revisions = new ConfigRevisionsRepo(db, "default");
      expect(revisions.fetchRecent(10).length).toBeGreaterThan(0);
    });
  });

  describe("GET/PUT /api/system", () => {
    it("returns defaults and the available option lists before anything is saved", async () => {
      await createUser(db, "owner@example.com", "pw-owner-123", "owner");
      const client = new TestClient(app);
      await client.login("owner@example.com", "pw-owner-123");

      const res = await client.get("/api/system");
      expect(res.statusCode).toBe(200);
      const body = res.json() as SystemResponse;
      expect(body.system.platforms).toEqual({});
      expect(body.system.alert_options).toEqual({ mode: "immediate", notify_empty: false });
      expect(body.options.providers).toEqual(expect.arrayContaining(["mock", "ollama", "claude"]));
      expect(body.canWrite).toBe(true);
    });

    it("only persists known platform keys and coerces missing ones to false", async () => {
      await createUser(db, "owner@example.com", "pw-owner-123", "owner");
      const client = new TestClient(app);
      await client.login("owner@example.com", "pw-owner-123");

      await client.put("/api/system", validSystem);
      const res = await client.get("/api/system");
      const body = res.json() as SystemResponse;

      expect(body.system.platforms.ebay).toBe(true);
      expect(body.system.platforms.grailed).toBe(true);
      expect(body.system.platforms.poshmark).toBe(false);
      expect(body.system.platforms.depop).toBe(false);
    });

    it("records an audit entry and a config revision snapshot on update", async () => {
      const userId = await createUser(db, "owner@example.com", "pw-owner-123", "owner");
      const client = new TestClient(app);
      await client.login("owner@example.com", "pw-owner-123");

      await client.put("/api/system", validSystem);

      const audit = new AuditLogRepo(db, "default").fetchRecent(10);
      const entry = audit.find((a) => a.action === "system.update");
      expect(entry?.user_id).toBe(userId);

      const revisions = new ConfigRevisionsRepo(db, "default");
      expect(revisions.fetchRecent(10).length).toBeGreaterThan(0);
    });

    it("rejects a malformed llm config (e.g. an unknown provider)", async () => {
      await createUser(db, "owner@example.com", "pw-owner-123", "owner");
      const client = new TestClient(app);
      await client.login("owner@example.com", "pw-owner-123");

      const res = await client.put("/api/system", {
        ...validSystem,
        llm: { ...validSystem.llm, provider: "not-a-real-provider" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("forbids GET/PUT for a role without system capabilities", async () => {
      await createUser(db, "curator@example.com", "pw-curator-123", "curator");
      const client = new TestClient(app);
      await client.login("curator@example.com", "pw-curator-123");

      expect((await client.get("/api/system")).statusCode).toBe(403);
      expect((await client.put("/api/system", validSystem)).statusCode).toBe(403);
    });
  });

  it("scopes taste and system settings per profile", async () => {
    await createUser(db, "owner1@example.com", "pw-owner1-123", "owner", "p1");
    await createUser(db, "owner2@example.com", "pw-owner2-123", "owner", "p2");

    const client1 = new TestClient(app);
    await client1.login("owner1@example.com", "pw-owner1-123");
    await client1.put("/api/taste", validTaste);

    const client2 = new TestClient(app);
    await client2.login("owner2@example.com", "pw-owner2-123");
    const res = await client2.get("/api/taste");
    expect((res.json() as TasteResponse).taste.aesthetic_prompt).toBe("");
  });
});
