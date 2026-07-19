import { describe, expect, it, vi, afterEach } from "vitest";
import { createNtfyAlerter } from "../../src/alerts/ntfy.js";
import { sampleListing } from "../helpers/fixtures.js";
import type { AlertConfig } from "../../src/core/config.js";
import type { ScoredListing } from "../../src/core/types.js";

const baseConfig: AlertConfig = {
  ntfy_url: "http://ntfy-test",
  ntfy_topic: "fashion-monitor-test",
  mode: "immediate",
  notify_empty: false,
};

function scoredListing(overrides: Partial<ScoredListing["result"]> = {}): ScoredListing {
  return {
    listing: sampleListing(),
    result: {
      listing_id: "ebay:abc123",
      score: "YES",
      quality: "pass",
      value: "pass",
      aesthetic: "pass",
      size: "HIGH",
      reason: "Great match",
      ...overrides,
    },
  };
}

describe("ntfy alerts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes a YES alert as JSON to the base ntfy URL with the topic in the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    const ok = await alerter.sendAlert(scoredListing({ score: "YES" }));

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://ntfy-test");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body));
    expect(body.topic).toBe("fashion-monitor-test");
    expect(body.priority).toBe(4);
    expect(body.tags).toEqual(["white_check_mark"]);
    expect(body.click).toBe("https://example.com/listing");
    expect(body.title).toContain("Helmut Lang");
    expect(body.message).toContain("Great match");
  });

  it("publishes a MAYBE alert with a lower priority and warning tag", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    await alerter.sendAlert(scoredListing({ score: "MAYBE" }));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.priority).toBe(3);
    expect(body.tags).toEqual(["warning"]);
  });

  it("sends a digest covering every match in one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    const ok = await alerter.sendDigest([
      scoredListing({ score: "YES" }),
      scoredListing({ score: "MAYBE" }),
    ]);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.title).toContain("2 matches");
    expect(body.message).toContain("[YES]");
    expect(body.message).toContain("[MAYBE]");
  });

  it("sends an empty-run notice", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    const ok = await alerter.sendEmptyRunNotice();

    expect(ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.title).toContain("no matches");
  });

  it("sends a Connections-page test notification", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    const ok = await alerter.sendTestNotification();

    expect(ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.title).toContain("connected");
    expect(body.topic).toBe("fashion-monitor-test");
  });

  it("includes a bearer token header when ntfy_token is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter({ ...baseConfig, ntfy_token: "secret-token" });
    await alerter.sendAlert(scoredListing());

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer secret-token");
  });

  it("omits the Authorization header when no token is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    await alerter.sendAlert(scoredListing());

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Authorization"]).toBeUndefined();
  });

  it("attaches the listing image via ntfy's attach field", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    await alerter.sendAlert(scoredListing());

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.attach).toBe("https://example.com/image.jpg");
  });

  it("omits attach when the listing has no image", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    await alerter.sendAlert({
      ...scoredListing(),
      listing: { ...sampleListing(), imageUrl: null },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.attach).toBeUndefined();
  });

  it("returns false and does not throw on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    const ok = await alerter.sendAlert(scoredListing());

    expect(ok).toBe(false);
  });

  it("returns false when the underlying fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const alerter = createNtfyAlerter(baseConfig);
    const ok = await alerter.sendAlert(scoredListing());

    expect(ok).toBe(false);
  });

  it("regression: keeps emoji out of header values (real fetch rejects non-ASCII headers)", async () => {
    // Node's real fetch throws "Cannot convert argument to a ByteString" if any
    // header value contains a character above U+00FF. The ✅/🟡 icons must stay
    // in the JSON body (title/message), never in a header.
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      for (const value of Object.values(init.headers as Record<string, string>)) {
        const hasNonByteStringChar = [...value].some((ch) => ch.codePointAt(0)! > 255);
        if (hasNonByteStringChar) {
          throw new TypeError(
            `Cannot convert argument to a ByteString because the character at index 0 has a value greater than 255.`,
          );
        }
      }
      return { ok: true };
    });
    vi.stubGlobal("fetch", fetchMock);

    const alerter = createNtfyAlerter(baseConfig);
    const ok = await alerter.sendAlert(scoredListing({ score: "YES" }));

    expect(ok).toBe(true);
  });
});
