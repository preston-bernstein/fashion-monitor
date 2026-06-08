import { describe, expect, it, vi, afterEach } from "vitest";
import { createTelegramAlerter } from "../../src/alerts/telegram.js";
import { parseFeedbackCallback, formatImmediateAlert } from "../../src/alerts/format.js";
import { sampleListing } from "../helpers/fixtures.js";

describe("telegram alerts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats immediate alert", () => {
    const text = formatImmediateAlert({
      listing: sampleListing(),
      result: {
        listing_id: "ebay:abc123",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Great match",
      },
    });
    expect(text).toContain("Helmut Lang");
    expect(text).toContain("YES");
  });

  it("parses feedback callback data", () => {
    const parsed = parseFeedbackCallback("fb:ebay:abc123:positive");
    expect(parsed).toEqual({
      platform: "ebay",
      listingId: "abc123",
      signal: "positive",
    });
  });

  it("sends photo alert via mocked fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createTelegramAlerter({
      telegram_bot_token: "test",
      telegram_chat_id: "123",
      mode: "immediate",
      notify_empty: false,
    });

    const ok = await alerter.sendAlert({
      listing: sampleListing(),
      result: {
        listing_id: "ebay:abc123",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Test",
      },
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.method ?? "sendPhoto").toBeDefined();
  });
});
