import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openDatabase, type Db } from "../../src/storage/db.js";
import { seedProfileFromConfig } from "../../src/storage/seed.js";
import { loadProfileConfig } from "../../src/core/profile-config.js";
import { SearchGroupsRepo, executionId } from "../../src/storage/repos/search-groups.js";
import { ProfileSettingsRepo } from "../../src/storage/repos/profile-settings.js";
import { ProfilesRepo } from "../../src/storage/repos/users.js";
import { minimalConfig } from "../helpers/fixtures.js";

describe("db-backed profile config", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("seeds DB from config.yaml on first boot, then reads it back", () => {
    const now = new Date().toISOString();
    const config = {
      ...minimalConfig,
      searches: {
        ebay: [{ id: "ebay-seed", q: "seed jacket xxl", enabled: true, status: "active" as const }],
      },
    };

    seedProfileFromConfig(db, config, now);

    expect(new ProfilesRepo(db).exists("default")).toBe(true);
    expect(new SearchGroupsRepo(db, "default").getGroup("ebay-seed")).toBeDefined();
    expect(new ProfileSettingsRepo(db, "default").get("aesthetic_prompt")).toBe(
      minimalConfig.aesthetic_prompt,
    );

    const loaded = loadProfileConfig(db, "default", { fallback: config });
    expect(loaded.aesthetic_prompt).toBe(minimalConfig.aesthetic_prompt);
    expect(loaded.searches?.ebay?.[0]?.id).toBe(executionId("ebay-seed", "ebay"));
    expect(loaded.searches?.ebay?.[0]?.groupId).toBe("ebay-seed");
    expect(loaded.alert.ntfy_url).toBe(minimalConfig.alert.ntfy_url);
    expect(loaded.profile_id).toBe("default");
  });

  it("does not clobber DB edits on a second seed", () => {
    const now = new Date().toISOString();
    seedProfileFromConfig(db, minimalConfig, now);

    const groups = new SearchGroupsRepo(db, "default");
    groups.createGroup(
      {
        id: "manual-add",
        query_text: "manual query",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      now,
    );
    new ProfileSettingsRepo(db, "default").set("aesthetic_prompt", "edited-by-web", now);

    seedProfileFromConfig(db, minimalConfig, now);

    expect(groups.getGroup("manual-add")).toBeDefined();
    const loaded = loadProfileConfig(db, "default", { fallback: minimalConfig });
    expect(loaded.aesthetic_prompt).toBe("edited-by-web");
    expect(loaded.searches?.ebay?.some((s) => s.groupId === "manual-add")).toBe(true);
  });

  it("resolves ntfy secrets from env over fallback", () => {
    const now = new Date().toISOString();
    seedProfileFromConfig(db, minimalConfig, now);
    process.env.NTFY_TOKEN = "env-token-xyz";
    try {
      const loaded = loadProfileConfig(db, "default", { fallback: minimalConfig });
      expect(loaded.alert.ntfy_token).toBe("env-token-xyz");
    } finally {
      delete process.env.NTFY_TOKEN;
    }
  });
});
