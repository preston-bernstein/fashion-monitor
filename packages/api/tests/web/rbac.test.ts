import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { SearchGroupsRepo } from "@fm/core/storage/repos/search-groups.js";
import { ProfileSettingsRepo } from "@fm/core/storage/repos/profile-settings.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";
import { capabilitiesForRole } from "../../src/web/rbac.js";
import type { Capability, Role } from "@fm/shared/rbac.js";

// Each read-only API surface and the capability that gates it.
const API_CAP: Record<string, Capability> = {
  "/api/dashboard": "analytics:read",
  "/api/monitors": "monitors:read",
  "/api/taste": "taste:read",
  "/api/system": "system:read",
  "/api/secrets": "secrets:read",
  "/api/audit": "system:read",
  "/api/users": "users:manage",
};

describe("rbac capability enforcement (JSON API)", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "owner@example.com", "pw-owner-1", "owner");
    await createUser(db, "curator@example.com", "pw-curator-1", "curator");
    await createUser(db, "operator@example.com", "pw-operator-1", "operator");
    await createUser(db, "viewer@example.com", "pw-viewer-1", "viewer");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  async function clientFor(email: string, pw: string): Promise<TestClient> {
    const c = new TestClient(app);
    const res = await c.login(email, pw);
    expect(res.statusCode).toBe(200);
    return c;
  }

  it("gates each read API by the matching capability for every role", async () => {
    const cases: Array<[string, string, Role]> = [
      ["owner@example.com", "pw-owner-1", "owner"],
      ["curator@example.com", "pw-curator-1", "curator"],
      ["operator@example.com", "pw-operator-1", "operator"],
      ["viewer@example.com", "pw-viewer-1", "viewer"],
    ];

    for (const [email, pw, role] of cases) {
      const client = await clientFor(email, pw);
      const caps = capabilitiesForRole(role);
      for (const [path, cap] of Object.entries(API_CAP)) {
        const res = await client.get(path);
        if (caps.has(cap)) {
          expect(res.statusCode, `${role} GET ${path}`).toBe(200);
        } else {
          expect(res.statusCode, `${role} GET ${path}`).toBe(403);
        }
      }
    }
  });

  it("exposes the resolved capability set via /api/me so the SPA can hide controls", async () => {
    const curator = await clientFor("curator@example.com", "pw-curator-1");
    const me = (await curator.get("/api/me")).json() as { capabilities: string[] };
    expect(me.capabilities).toContain("monitors:write");
    expect(me.capabilities).not.toContain("secrets:read");
    expect(me.capabilities).not.toContain("users:manage");
  });

  it("lets a curator create monitors but blocks secrets and users", async () => {
    const curator = await clientFor("curator@example.com", "pw-curator-1");

    const create = await curator.post("/api/monitors", {
      id: "ebay-test",
      platforms: ["ebay"],
      query_text: "corduroy jacket xxl",
      status: "active",
      enabled: true,
    });
    expect(create.statusCode).toBe(201);
    expect(new SearchGroupsRepo(db, "default").getGroup("ebay-test")).toBeDefined();

    const secretAttempt = await curator.put("/api/secrets", {
      key: "telegram_bot_token",
      value: "nope",
    });
    expect(secretAttempt.statusCode).toBe(403);

    const usersAttempt = await curator.get("/api/users");
    expect(usersAttempt.statusCode).toBe(403);
  });

  it("lets an operator edit system + secrets but blocks taste writes and monitor writes", async () => {
    const operator = await clientFor("operator@example.com", "pw-operator-1");

    const sys = await operator.put("/api/system", {
      platforms: { ebay: true },
      llm: {
        provider: "mock",
        batch_size: 10,
        ollama_text_model: "qwen2.5:7b",
        claude_model: "claude-haiku-4-5",
        vision_backend: "ollama",
      },
      alert_options: { mode: "digest", notify_empty: false },
      scraper: { poshmark_profile_path: "data/poshmark-profile" },
    });
    expect(sys.statusCode).toBe(200);
    const stored = new ProfileSettingsRepo(db, "default").get<{ mode: string }>("alert_options");
    expect(stored?.mode).toBe("digest");

    const secret = await operator.put("/api/secrets", {
      key: "telegram_bot_token",
      value: "operator-set-token",
    });
    expect(secret.statusCode).toBe(200);

    // taste:write denied (operator can read taste, not write it).
    const tasteAttempt = await operator.put("/api/taste", {
      aesthetic_prompt: "hijack",
      hard_no: [],
      positive_signals: { strong: [], weak: [] },
      price_ceiling: { default: 100 },
      measurements: {},
    });
    expect(tasteAttempt.statusCode).toBe(403);

    // monitors:write denied.
    const monitorAttempt = await operator.post("/api/monitors", {
      id: "x",
      platform: "ebay",
      query_text: "y",
    });
    expect(monitorAttempt.statusCode).toBe(403);
  });

  it("lets an owner manage users", async () => {
    const owner = await clientFor("owner@example.com", "pw-owner-1");
    const res = await owner.post("/api/users", {
      email: "newbie@example.com",
      password: "newbie-password-1",
      role: "viewer",
    });
    expect(res.statusCode).toBe(201);

    const viewer = new TestClient(app);
    const login = await viewer.login("newbie@example.com", "newbie-password-1");
    expect(login.statusCode).toBe(200);
  });

  it("strips integration health from dashboard for users without secrets:read", async () => {
    const curator = await clientFor("curator@example.com", "pw-curator-1");
    const dash = (await curator.get("/api/dashboard")).json() as {
      integrationUptime: unknown[];
      integrationFailures: unknown[];
    };
    expect(dash.integrationUptime).toEqual([]);
    expect(dash.integrationFailures).toEqual([]);

    const operator = await clientFor("operator@example.com", "pw-operator-1");
    const opsDash = (await operator.get("/api/dashboard")).json() as {
      integrationUptime: unknown[];
      integrationFailures: unknown[];
    };
    // Operator has secrets:read — fields are present (may be empty arrays if no events).
    expect(Array.isArray(opsDash.integrationUptime)).toBe(true);
    expect(Array.isArray(opsDash.integrationFailures)).toBe(true);
  });

  it("returns audit entries for operators", async () => {
    const operator = await clientFor("operator@example.com", "pw-operator-1");
    const res = await operator.get("/api/audit");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
    // Login events from test setup should appear.
    expect(body.entries.length).toBeGreaterThan(0);
  });

  it("protects the last owner from demotion", async () => {
    const owner = await clientFor("owner@example.com", "pw-owner-1");
    const me = (await owner.get("/api/me")).json() as { user: { id: number } };
    const res = await owner.patch(`/api/users/${me.user.id}/role`, { role: "viewer" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("last_owner");
  });
});
