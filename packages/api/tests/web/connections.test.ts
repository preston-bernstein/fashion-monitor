import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";

interface ConnectionDto {
  platform: string;
  type: string;
  dormant: boolean;
  automatic: boolean;
  configured: boolean;
  status: string;
  lastTestedAt: string | null;
  lastError: string | null;
}

describe("GET /api/connections", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "owner@example.com", "pw-owner-123", "owner");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("lists every platform with the right tier defaults", async () => {
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");
    const res = await client.get("/api/connections");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { connections: ConnectionDto[] };
    const byPlatform = Object.fromEntries(body.connections.map((c) => [c.platform, c]));

    expect(byPlatform.ebay).toMatchObject({
      type: "api-key",
      dormant: false,
      configured: false,
      status: "not_connected",
    });
    expect(byPlatform.grailed).toMatchObject({ type: "none", automatic: true, status: "ok" });
    expect(byPlatform.ntfy).toMatchObject({
      type: "api-key",
      configured: true,
      status: "untested",
    });
    expect(byPlatform.vestiaire).toMatchObject({ dormant: true, status: "not_connected" });
    expect(byPlatform.poshmark).toMatchObject({ dormant: true });
    expect(byPlatform.depop).toMatchObject({ dormant: true });
    expect(body.connections.find((c) => c.platform === "vinted")).toBeUndefined();
  });

  it("curator (no secrets:read) is forbidden", async () => {
    await createUser(db, "curator@example.com", "pw-curator-123", "curator");
    const client = new TestClient(app);
    await client.login("curator@example.com", "pw-curator-123");
    const res = await client.get("/api/connections");
    expect(res.statusCode).toBe(403);
  });

  it("shows eBay as configured once both secrets are set", async () => {
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");
    await client.put("/api/secrets", { key: "ebay_client_id", value: "id-123" });
    await client.put("/api/secrets", { key: "ebay_client_secret", value: "secret-123" });

    const res = await client.get("/api/connections");
    const body = res.json() as { connections: ConnectionDto[] };
    const ebay = body.connections.find((c) => c.platform === "ebay")!;
    expect(ebay.configured).toBe(true);
    expect(ebay.status).toBe("untested");
  });
});

describe("POST /api/connections/:platform/test", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "owner@example.com", "pw-owner-123", "owner");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    db.close();
  });

  it("rejects testing a dormant (login) connection", async () => {
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");
    const res = await client.post("/api/connections/poshmark/test");
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("dormant");
  });

  it("rejects testing an automatic (none) connection", async () => {
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");
    const res = await client.post("/api/connections/grailed/test");
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("no_test");
  });

  it("404s for an unknown platform", async () => {
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");
    const res = await client.post("/api/connections/notaplatform/test");
    expect(res.statusCode).toBe(404);
  });

  it("tests ntfy successfully and records an ok integration_event + audit entry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");

    const res = await client.post("/api/connections/ntfy/test");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");

    const listRes = await client.get("/api/connections");
    const ntfy = (listRes.json() as { connections: ConnectionDto[] }).connections.find(
      (c) => c.platform === "ntfy",
    )!;
    expect(ntfy.status).toBe("ok");
    expect(ntfy.lastTestedAt).toBeTruthy();

    const audit = new AuditLogRepo(db, "default").fetchRecent(20);
    expect(audit.some((a) => a.action === "connection.test" && a.target === "ntfy")).toBe(true);
  });

  it("tests ntfy failure and records a failed integration_event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");

    const res = await client.post("/api/connections/ntfy/test");
    const body = res.json() as { ok: boolean; status: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("failed");

    const listRes = await client.get("/api/connections");
    const ntfy = (listRes.json() as { connections: ConnectionDto[] }).connections.find(
      (c) => c.platform === "ntfy",
    )!;
    expect(ntfy.status).toBe("failed");
  });

  it("tests eBay using the profile's own connected credential, not env", async () => {
    process.env.EBAY_CLIENT_ID = "shared-env-id";
    process.env.EBAY_CLIENT_SECRET = "shared-env-secret";
    try {
      const client = new TestClient(app);
      await client.login("owner@example.com", "pw-owner-123");
      await client.put("/api/secrets", { key: "ebay_client_id", value: "profiles-own-id" });
      await client.put("/api/secrets", { key: "ebay_client_secret", value: "profiles-own-secret" });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600, itemSummaries: [] }),
        status: 200,
      });
      vi.stubGlobal("fetch", fetchMock);

      const res = await client.post("/api/connections/ebay/test");
      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);

      const [, tokenInit] = fetchMock.mock.calls[0];
      const b64 = (tokenInit.headers as Record<string, string>).Authorization.replace("Basic ", "");
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).toBe("profiles-own-id:profiles-own-secret");
    } finally {
      delete process.env.EBAY_CLIENT_ID;
      delete process.env.EBAY_CLIENT_SECRET;
    }
  });
});

describe("POST /api/connections/:platform/disconnect", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "owner@example.com", "pw-owner-123", "owner");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("removes the connection's secrets and flips it back to not_connected", async () => {
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");
    await client.put("/api/secrets", { key: "ebay_client_id", value: "id-123" });
    await client.put("/api/secrets", { key: "ebay_client_secret", value: "secret-123" });

    const disconnectRes = await client.post("/api/connections/ebay/disconnect");
    expect(disconnectRes.statusCode).toBe(200);

    const listRes = await client.get("/api/connections");
    const ebay = (listRes.json() as { connections: ConnectionDto[] }).connections.find(
      (c) => c.platform === "ebay",
    )!;
    expect(ebay.configured).toBe(false);
    expect(ebay.status).toBe("not_connected");

    const secretsRes = await client.get("/api/secrets");
    const keys = (secretsRes.json() as { secrets: Array<{ key: string }> }).secrets.map(
      (s) => s.key,
    );
    expect(keys).not.toContain("ebay_client_id");
    expect(keys).not.toContain("ebay_client_secret");
  });

  it("rejects disconnecting a dormant or automatic connection", async () => {
    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");
    expect((await client.post("/api/connections/poshmark/disconnect")).statusCode).toBe(400);
    expect((await client.post("/api/connections/grailed/disconnect")).statusCode).toBe(400);
  });
});
