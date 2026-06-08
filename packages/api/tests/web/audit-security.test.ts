import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";

function auditActions(db: Db): string[] {
  return new AuditLogRepo(db, "default").fetchRecent(100).map((row) => row.action);
}

function latestAuditDetail(db: Db, action: string): Record<string, unknown> | null {
  const row = new AuditLogRepo(db, "default")
    .fetchRecent(100)
    .find((entry) => entry.action === action);
  if (!row?.detail) return null;
  return JSON.parse(row.detail) as Record<string, unknown>;
}

describe("audit security events", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "curator@example.com", "pw-curator-1", "curator");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("records auth.forbidden on mutating requests blocked by capability", async () => {
    const curator = new TestClient(app);
    await curator.login("curator@example.com", "pw-curator-1");

    const before = auditActions(db).filter((a) => a === "auth.forbidden").length;
    const res = await curator.put("/api/secrets", {
      key: "telegram_bot_token",
      value: "blocked",
    });
    expect(res.statusCode).toBe(403);

    const after = auditActions(db).filter((a) => a === "auth.forbidden");
    expect(after.length).toBe(before + 1);

    const detail = latestAuditDetail(db, "auth.forbidden");
    expect(detail?.capability).toBe("secrets:write");
    expect(detail?.path).toBe("/api/secrets");
    expect(detail?.method).toBe("PUT");
    expect(detail?.requestId).toBeTruthy();
  });

  it("does not audit auth.forbidden on read-only GET 403", async () => {
    const curator = new TestClient(app);
    await curator.login("curator@example.com", "pw-curator-1");

    const before = auditActions(db).filter((a) => a === "auth.forbidden").length;
    const res = await curator.get("/api/secrets");
    expect(res.statusCode).toBe(403);
    const after = auditActions(db).filter((a) => a === "auth.forbidden");
    expect(after.length).toBe(before);
  });

  it("records auth.csrf.failed on mutating requests without a CSRF token", async () => {
    const before = auditActions(db).filter((a) => a === "auth.csrf.failed").length;
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "curator@example.com", password: "pw-curator-1" }),
    });
    expect(res.statusCode).toBe(403);

    const after = auditActions(db).filter((a) => a === "auth.csrf.failed");
    expect(after.length).toBe(before + 1);

    const detail = latestAuditDetail(db, "auth.csrf.failed");
    expect(detail?.path).toBe("/api/login");
    expect(detail?.method).toBe("POST");
    expect(detail?.requestId).toBeTruthy();
    expect(detail).not.toHaveProperty("csrfToken");
  });
});
