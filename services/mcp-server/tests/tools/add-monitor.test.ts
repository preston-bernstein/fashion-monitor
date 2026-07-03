import { describe, expect, it } from "vitest";
import { openDatabase, migrate } from "@fm/core/storage/db.js";
import { SearchGroupsRepo } from "@fm/core/storage/repos/search-groups.js";
import { MAX_MONITORS_PER_PROFILE } from "@fm/shared/limits.js";
import { createAddMonitor } from "../../src/tools/add-monitor.js";

describe("add_monitor MCP tool — max_monitors_per_profile cap", () => {
  it("allows the boundary monitor and rejects the one after the cap", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const profileId = "default";
    const addMonitor = createAddMonitor(db, profileId);
    const groups = new SearchGroupsRepo(db, profileId);

    // Seed 24 monitors directly so the boundary (#25) and over-cap (#26)
    // attempts go through the real add_monitor tool path.
    const ts = new Date().toISOString();
    for (let i = 1; i <= MAX_MONITORS_PER_PROFILE - 1; i++) {
      groups.createGroup(
        {
          id: `seed-monitor-${i}`,
          query_text: `seed query ${i}`,
          platforms: ["ebay"],
          query_overrides: {},
          enabled: true,
          status: "active",
          note: null,
        },
        ts,
      );
    }
    expect(groups.countGroups()).toBe(MAX_MONITORS_PER_PROFILE - 1);

    // #MAX_MONITORS_PER_PROFILE (25) is the boundary — must succeed.
    const boundary = await addMonitor({ query: "boundary monitor query" });
    const boundaryBody = JSON.parse(boundary.content[0].text) as { ok: boolean; id: string };
    expect(boundaryBody.ok).toBe(true);
    expect(groups.countGroups()).toBe(MAX_MONITORS_PER_PROFILE);

    // #26 must be rejected with the same error shape used elsewhere.
    const overCap = await addMonitor({ query: "over cap monitor query" });
    const overCapBody = JSON.parse(overCap.content[0].text) as {
      ok: boolean;
      error?: string;
      message?: string;
    };
    expect(overCapBody.ok).toBe(false);
    expect(overCapBody.error).toBe("monitor_limit_reached");
    expect(groups.countGroups()).toBe(MAX_MONITORS_PER_PROFILE);

    db.close();
  });
});
