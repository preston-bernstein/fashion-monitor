import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { mockScraper } from "../helpers/scrapers.js";
import { yesBatchProvider } from "../helpers/mock-provider.js";
import { createTestDb } from "../helpers/db.js";
import { sampleListing } from "../helpers/fixtures.js";

describe("digest alert mode", () => {
  let config: ReturnType<typeof createTestDb>["config"];
  let db: ReturnType<typeof createTestDb>["db"];

  beforeEach(() => {
    const setup = createTestDb("fm-digest-");
    config = {
      ...setup.config,
      alert: { ...setup.config.alert, mode: "digest" },
    };
    db = setup.db;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("sends one digest message for multiple matches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const stats = await runPipeline({
      config,
      db,
      scrapers: [
        mockScraper("ebay", [sampleListing({ platform: "ebay", id: "e1" })]),
        mockScraper("grailed", [sampleListing({ platform: "grailed", id: "g1" })]),
      ],
      provider: yesBatchProvider("Digest match"),
    });

    expect(stats.alertsSent).toBe(2);
    const sendMessageCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("sendMessage"),
    );
    expect(sendMessageCalls).toHaveLength(1);

    const body = JSON.parse(String(sendMessageCalls[0][1]?.body));
    expect(body.text).toContain("2 matches");
    expect(body.text).toContain("Digest match");
  });
});
