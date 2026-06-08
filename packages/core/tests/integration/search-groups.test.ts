import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { openDatabase } from "../../src/storage/db.js";
import { ScrapeQueriesRepo } from "../../src/storage/repos/scrape-queries.js";
import { SearchGroupsRepo, executionId } from "../../src/storage/repos/search-groups.js";
import { mockScraper } from "../helpers/scrapers.js";
import { yesBatchProvider } from "../helpers/mock-provider.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";

describe("search groups", () => {
  it("syncs execution rows per platform on create", () => {
    const db = openDatabase(":memory:");
    const ts = "2026-06-08T12:00:00.000Z";
    const groups = new SearchGroupsRepo(db, "default");

    groups.createGroup(
      {
        id: "corduroy-jacket",
        query_text: "men corduroy jacket XXL",
        platforms: ["ebay", "depop", "grailed"],
        query_overrides: { depop: "corduroy shirt dark" },
        enabled: true,
        status: "active",
        note: null,
      },
      ts,
    );

    const executions = groups.listExecutions("corduroy-jacket");
    expect(executions).toHaveLength(3);
    expect(executions.map((e) => e.id).sort()).toEqual(
      [
        executionId("corduroy-jacket", "depop"),
        executionId("corduroy-jacket", "ebay"),
        executionId("corduroy-jacket", "grailed"),
      ].sort(),
    );
    expect(executions.find((e) => e.platform === "depop")?.query_text).toBe("corduroy shirt dark");
    expect(executions.every((e) => e.group_id === "corduroy-jacket")).toBe(true);

    db.close();
  });

  it("records listings with group source_query_id through pipeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      }),
    );

    const db = openDatabase(":memory:");
    const ts = "2026-06-08T12:00:00.000Z";
    const groups = new SearchGroupsRepo(db, "default");
    groups.createGroup(
      {
        id: "multi-platform",
        query_text: "test jacket",
        platforms: ["ebay", "depop", "grailed"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      ts,
    );

    const config = {
      ...minimalConfig,
      searches: {
        ebay: [
          {
            id: executionId("multi-platform", "ebay"),
            q: "test jacket",
            groupId: "multi-platform",
            status: "active" as const,
          },
        ],
        depop: [
          {
            id: executionId("multi-platform", "depop"),
            q: "test jacket",
            groupId: "multi-platform",
            status: "active" as const,
          },
        ],
        grailed: [
          {
            id: executionId("multi-platform", "grailed"),
            q: "test jacket",
            groupId: "multi-platform",
            status: "active" as const,
          },
        ],
      },
    };

    await runPipeline({
      config,
      db,
      scrapers: [
        mockScraper(
          "ebay",
          [sampleListing({ platform: "ebay", id: "e1" })],
          executionId("multi-platform", "ebay"),
          "multi-platform",
        ),
      ],
      provider: yesBatchProvider("Group test"),
    });

    const alert = db
      .prepare(`SELECT source_query_id FROM alert_log WHERE listing_id = 'e1'`)
      .get() as { source_query_id: string };
    expect(alert.source_query_id).toBe("multi-platform");

    const queryRuns = db
      .prepare(`SELECT query_id, group_id, alerts_sent FROM scrape_query_runs`)
      .all() as Array<{ query_id: string; group_id: string; alerts_sent: number }>;
    expect(queryRuns[0].query_id).toBe(executionId("multi-platform", "ebay"));
    expect(queryRuns[0].group_id).toBe("multi-platform");
    expect(queryRuns[0].alerts_sent).toBe(1);

    const scorecard = groups.fetchGroupScorecard();
    expect(scorecard.some((r) => r.group_id === "multi-platform")).toBe(true);

    db.close();
    vi.restoreAllMocks();
  });

  it("rolls up group scorecard metrics", () => {
    const db = openDatabase(":memory:");
    const ts = "2026-06-08T12:00:00.000Z";
    const groups = new SearchGroupsRepo(db, "default");
    const queries = new ScrapeQueriesRepo(db, "default");

    groups.createGroup(
      {
        id: "rollup-test",
        query_text: "rollup query",
        platforms: ["ebay", "depop"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      ts,
    );

    const runId = db.prepare(`INSERT INTO runs (started_at) VALUES (?)`).run(ts).lastInsertRowid as number;
    queries.recordQueryRuns(Number(runId), [
      {
        queryId: executionId("rollup-test", "ebay"),
        groupId: "rollup-test",
        platform: "ebay",
        queryText: "rollup query",
        listingsFound: 5,
        listingsNew: 2,
        scoredYes: 1,
        scoredMaybe: 0,
        scoredNo: 0,
        prefilterRejected: 0,
        alertsSent: 1,
        error: null,
      },
      {
        queryId: executionId("rollup-test", "depop"),
        groupId: "rollup-test",
        platform: "depop",
        queryText: "rollup query",
        listingsFound: 3,
        listingsNew: 1,
        scoredYes: 0,
        scoredMaybe: 0,
        scoredNo: 0,
        prefilterRejected: 0,
        alertsSent: 0,
        error: null,
      },
    ]);

    const row = groups.fetchGroupScorecard().find((r) => r.group_id === "rollup-test");
    expect(row).toBeDefined();
    expect(row!.listings_found).toBe(8);
    expect(row!.listings_new).toBe(3);
    expect(row!.alerts_sent).toBe(1);

    db.close();
  });

  it("syncs search groups from config yaml shape", () => {
    const db = openDatabase(":memory:");
    const ts = "2026-06-08T12:00:00.000Z";
    const groups = new SearchGroupsRepo(db, "default");

    groups.syncFromConfig(
      {
        ...minimalConfig,
        searches: {
          ebay: [{ id: "ebay-seed", q: "seed jacket xxl", enabled: true, status: "active" }],
        },
      },
      ts,
    );

    expect(groups.getGroup("ebay-seed")).toBeDefined();
    const executions = groups.listExecutions("ebay-seed");
    expect(executions).toHaveLength(1);
    expect(executions[0].id).toBe(executionId("ebay-seed", "ebay"));
    expect(executions[0].group_id).toBe("ebay-seed");

    db.close();
  });
});
