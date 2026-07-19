import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Db } from "../../src/storage/db.js";
import { AuditLogRepo } from "../../src/storage/repos/audit-log.js";
import { createMemoryDb } from "../helpers/db.js";

describe("AuditLogRepo", () => {
  let db: Db;

  beforeEach(() => {
    db = createMemoryDb().db;
  });

  afterEach(() => {
    db.close();
  });

  it("records and fetches recent entries newest-first", () => {
    const repo = new AuditLogRepo(db, "default");
    repo.record(
      { userId: 1, actorEmail: "a@example.com", action: "login.success" },
      "2026-01-01T00:00:00.000Z",
    );
    repo.record(
      { userId: 1, actorEmail: "a@example.com", action: "login.success" },
      "2026-01-02T00:00:00.000Z",
    );

    const recent = repo.fetchRecent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].recorded_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("recordFromRequest JSON-encodes detail and defaults target to null", () => {
    const repo = new AuditLogRepo(db, "default");
    repo.recordFromRequest(
      { userId: 1, actorEmail: "a@example.com" },
      "secret.upsert",
      "2026-01-01T00:00:00.000Z",
      { detail: { key: "ntfy_token" } },
    );

    const [row] = repo.fetchRecent(1);
    expect(row.target).toBeNull();
    expect(JSON.parse(row.detail!)).toEqual({ key: "ntfy_token" });
  });

  it("scopes fetchRecent to the repo's own profile", () => {
    const repoA = new AuditLogRepo(db, "profile-a");
    const repoB = new AuditLogRepo(db, "profile-b");
    repoA.record(
      { userId: 1, actorEmail: null, action: "login.success" },
      "2026-01-01T00:00:00.000Z",
    );
    repoB.record(
      { userId: 2, actorEmail: null, action: "login.success" },
      "2026-01-01T00:00:00.000Z",
    );

    expect(repoA.fetchRecent(10)).toHaveLength(1);
    expect(repoB.fetchRecent(10)).toHaveLength(1);
  });

  it("fetchFiltered filters by category via its SQL mapping", () => {
    const repo = new AuditLogRepo(db, "default");
    repo.record(
      { userId: 1, actorEmail: null, action: "login.success" },
      "2026-01-01T00:00:00.000Z",
    );
    repo.record(
      { userId: 1, actorEmail: null, action: "secret.upsert" },
      "2026-01-01T00:00:01.000Z",
    );
    repo.record(
      { userId: 1, actorEmail: null, action: "search_group.create" },
      "2026-01-01T00:00:02.000Z",
    );

    const auth = repo.fetchFiltered({ category: "auth" });
    expect(auth.entries.map((e) => e.action)).toEqual(["login.success"]);

    const monitors = repo.fetchFiltered({ category: "monitors" });
    expect(monitors.entries.map((e) => e.action)).toEqual(["search_group.create"]);
  });

  it("fetchFiltered falls back to actionPrefix only when no category is given", () => {
    const repo = new AuditLogRepo(db, "default");
    repo.record(
      { userId: 1, actorEmail: null, action: "invite.create" },
      "2026-01-01T00:00:00.000Z",
    );
    repo.record(
      { userId: 1, actorEmail: null, action: "invite.redeem" },
      "2026-01-01T00:00:01.000Z",
    );
    repo.record(
      { userId: 1, actorEmail: null, action: "profile.delete" },
      "2026-01-01T00:00:02.000Z",
    );

    const filtered = repo.fetchFiltered({ actionPrefix: "invite." });
    expect(filtered.entries).toHaveLength(2);
    expect(filtered.total).toBe(2);
  });

  it("fetchFiltered filters by actorEmail and since, and paginates with total independent of limit", () => {
    const repo = new AuditLogRepo(db, "default");
    repo.record(
      { userId: 1, actorEmail: "a@example.com", action: "login.success" },
      "2026-01-01T00:00:00.000Z",
    );
    repo.record(
      { userId: 2, actorEmail: "b@example.com", action: "login.success" },
      "2026-01-02T00:00:00.000Z",
    );
    repo.record(
      { userId: 1, actorEmail: "a@example.com", action: "login.success" },
      "2026-01-03T00:00:00.000Z",
    );

    const byActor = repo.fetchFiltered({ actorEmail: "a@example.com" });
    expect(byActor.total).toBe(2);

    const since = repo.fetchFiltered({ since: "2026-01-02T00:00:00.000Z" });
    expect(since.total).toBe(2);

    const paged = repo.fetchFiltered({ limit: 1, offset: 1 });
    expect(paged.entries).toHaveLength(1);
    expect(paged.total).toBe(3);
  });

  it("clamps limit to between 1 and 100", () => {
    const repo = new AuditLogRepo(db, "default");
    for (let i = 0; i < 5; i++) {
      repo.record(
        { userId: 1, actorEmail: null, action: "login.success" },
        `2026-01-0${i + 1}T00:00:00.000Z`,
      );
    }

    expect(repo.fetchFiltered({ limit: 0 }).entries).toHaveLength(1);
    expect(repo.fetchFiltered({ limit: 1000 }).entries).toHaveLength(5);
  });
});
