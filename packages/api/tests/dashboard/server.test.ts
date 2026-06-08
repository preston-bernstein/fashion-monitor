import { describe, expect, it, afterEach } from "vitest";
import { openDatabase } from "@fm/core/storage/db.js";
import { createDashboardServer, type DashboardServer } from "../../src/dashboard/server.js";
import { minimalConfig } from "../helpers/fixtures.js";
import { RunsRepo } from "@fm/core/storage/repos/runs.js";
import { TestClient, seedAdmin, TEST_SESSION_SECRET } from "../helpers/web.js";

describe("dashboard server", () => {
  const db = openDatabase(":memory:");
  let server: DashboardServer | undefined;

  afterEach(async () => {
    if (server) await server.stop();
    server = undefined;
  });

  it("serves health publicly, gates the JSON API, and serves the SPA shell", async () => {
    const runs = new RunsRepo(db);
    const runId = runs.start(new Date().toISOString());
    runs.finish(
      runId,
      new Date().toISOString(),
      {
        listingsFound: 1,
        listingsNew: 1,
        scoredYes: 0,
        scoredMaybe: 0,
        scoredNo: 0,
        alertsSent: 0,
        prefilterRejected: 0,
        errors: [],
      },
      null,
    );

    await seedAdmin(db, "owner@example.com", "owner-password-1");

    server = await createDashboardServer({
      config: minimalConfig,
      db,
      sessionSecret: TEST_SESSION_SECRET,
      rateLimitMax: 100000,
      loginRateLimitMax: 100000,
    });

    // Health is public.
    const health = await server.app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    // Unauthenticated dashboard JSON is rejected with 401 (not a redirect).
    const unauth = await server.app.inject({ method: "GET", url: "/api/dashboard" });
    expect(unauth.statusCode).toBe(401);

    // The SPA shell is served for client routes regardless of auth.
    const shell = await server.app.inject({ method: "GET", url: "/" });
    expect(shell.statusCode).toBe(200);
    expect(shell.headers["content-type"]).toContain("text/html");

    // After login, the dashboard JSON is available.
    const client = new TestClient(server.app);
    const login = await client.login("owner@example.com", "owner-password-1");
    expect(login.statusCode).toBe(200);

    const dash = await client.get("/api/dashboard");
    expect(dash.statusCode).toBe(200);
    const body = dash.json() as { overview: { totalRuns: number } };
    expect(body.overview.totalRuns).toBeGreaterThanOrEqual(1);
  });
});
