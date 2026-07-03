import { describe, expect, it, afterEach } from "vitest";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { seedProfileFromConfig } from "@fm/core/storage/seed.js";
import { ProfilesRepo } from "@fm/core/storage/repos/users.js";
import type { Config } from "@fm/core/core/config.js";
import type { Listing } from "@fm/core/core/types.js";
import type { PlatformScraper } from "@fm/core/platforms/types.js";
import { runProfilesSerially } from "../src/run.js";

const baseConfig: Config = {
  profile_id: "default",
  measurements: { typical_size: "XXL", chest_in: "YOUR_CHEST" },
  aesthetic_prompt: "Dark academic aesthetic.",
  hard_no: ["slim fit"],
  positive_signals: { strong: ["corduroy"], weak: [] },
  price_ceiling: { tops: 300, pants: 250, outerwear: 500, default: 300 },
  platforms: {
    ebay: true,
    grailed: false,
    vestiaire: false,
    vinted: false,
    depop: false,
    poshmark: false,
  },
  llm: {
    provider: "mock",
    batch_size: 15,
    ollama_text_model: "qwen2.5:7b",
    claude_model: "claude-haiku-4-5",
    vision_backend: "ollama",
  },
  alert: {
    ntfy_url: "http://ntfy-test",
    ntfy_topic: "fashion-monitor-test",
    mode: "immediate",
    notify_empty: false,
  },
  database: { path: ":memory:" },
  scraper: { poshmark_profile_path: "data/poshmark-profile" },
};

function sampleListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "abc123",
    platform: "ebay",
    title: "Helmut Lang Wool Crewneck XXL",
    description: "Black slub cotton, relaxed fit, excellent condition.",
    price: 85,
    currency: "USD",
    size: "XXL",
    brand: "Helmut Lang",
    url: "https://example.com/listing",
    imageUrl: "https://example.com/image.jpg",
    listedAt: new Date("2025-01-01"),
    condition: "excellent",
    raw: {},
    ...overrides,
  } as Listing;
}

/** Scraper stub: throws when asked to run a query whose id is in `failingQueryIds`. */
function stubScraper(failingQueryIds: string[] = []): PlatformScraper {
  return {
    platform: "ebay",
    async search(queries) {
      if (queries.some((q) => failingQueryIds.includes(q.queryId))) {
        throw new Error("stub scraper failure");
      }
      const listings = queries.map((q) =>
        sampleListing({ id: q.queryId, sourceQueryId: q.sourceQueryId }),
      );
      return {
        ok: true,
        listings,
        queryResults: queries.map((q) => ({
          queryId: q.queryId,
          groupId: q.sourceQueryId,
          queryText: q.text,
          platform: "ebay" as const,
          ok: true,
          listings: listings.filter((l) => l.id === q.queryId),
        })),
      };
    },
  };
}

describe("runProfilesSerially", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("runs the pipeline once per profile serially, scoped by profile_id, and skips profiles with no monitors", async () => {
    db = openDatabase(":memory:");
    const now = new Date().toISOString();

    const defaultConfig: Config = {
      ...baseConfig,
      profile_id: "default",
      searches: {
        ebay: [{ id: "ebay-default", q: "corduroy jacket", enabled: true, status: "active" }],
      },
    };
    const p2Config: Config = {
      ...baseConfig,
      profile_id: "p2",
      searches: { ebay: [{ id: "ebay-p2", q: "waffle knit", enabled: true, status: "active" }] },
    };
    seedProfileFromConfig(db, defaultConfig, now);
    seedProfileFromConfig(db, p2Config, now);
    // p3 exists (e.g. invited but hasn't configured a Monitor yet) but is
    // never synced via seedProfileFromConfig, so it has zero DB monitors —
    // seedProfileFromConfig would otherwise fall back to DEFAULT_SEARCHES.
    new ProfilesRepo(db).ensure("p3", "p3", now);

    const result = await runProfilesSerially(db, defaultConfig, undefined, {
      scrapers: [stubScraper()],
    });

    expect(result.profileCount).toBe(3);
    expect(result.failures).toBe(0);

    const rows = db
      .prepare(`SELECT profile_id, COUNT(*) AS n FROM runs GROUP BY profile_id ORDER BY profile_id`)
      .all() as Array<{ profile_id: string; n: number }>;
    expect(rows).toEqual([
      { profile_id: "default", n: 1 },
      { profile_id: "p2", n: 1 },
    ]);
  });

  it("isolates a per-profile pipeline failure without aborting the remaining profiles", async () => {
    db = openDatabase(":memory:");
    const now = new Date().toISOString();

    const defaultConfig: Config = {
      ...baseConfig,
      profile_id: "default",
      searches: {
        ebay: [{ id: "ebay-default", q: "corduroy jacket", enabled: true, status: "active" }],
      },
    };
    const p2Config: Config = {
      ...baseConfig,
      profile_id: "p2",
      searches: {
        ebay: [{ id: "ebay-p2-fail", q: "waffle knit", enabled: true, status: "active" }],
      },
    };

    seedProfileFromConfig(db, defaultConfig, now);
    seedProfileFromConfig(db, p2Config, now);

    // p2's query id triggers the scraper stub failure; default's does not.
    const result = await runProfilesSerially(db, defaultConfig, undefined, {
      scrapers: [stubScraper(["ebay-p2-fail@ebay"])],
    });

    expect(result.profileCount).toBe(2);
    expect(result.failures).toBe(1);

    const rows = db
      .prepare(`SELECT profile_id, error FROM runs ORDER BY profile_id`)
      .all() as Array<{ profile_id: string; error: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.profile_id === "default")?.error).toBeNull();
    expect(rows.find((r) => r.profile_id === "p2")?.error).not.toBeNull();
  });
});
