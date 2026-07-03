import { describe, expect, it, vi } from "vitest";
import {
  grailedAlgoliaHeaders,
  grailedAlgoliaUrl,
  queryGrailedAlgolia,
} from "../../src/platforms/grailed/algolia.js";
import grailedFixture from "../fixtures/grailed/algolia-response.json";

describe("grailedAlgoliaUrl", () => {
  it("builds the per-application Algolia index URL", () => {
    expect(grailedAlgoliaUrl("ABC123")).toBe(
      "https://ABC123-dsn.algolia.net/1/indexes/Post_production/query",
    );
  });
});

describe("grailedAlgoliaHeaders", () => {
  it("includes the app id and api key in the Algolia auth headers", () => {
    const headers = grailedAlgoliaHeaders("ABC123", "secret-key");
    expect(headers["x-algolia-application-id"]).toBe("ABC123");
    expect(headers["x-algolia-api-key"]).toBe("secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("queryGrailedAlgolia", () => {
  it("posts the query body to the app-specific URL with auth headers and returns the parsed JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => grailedFixture,
    });

    const result = await queryGrailedAlgolia(
      { query: "corduroy jacket" },
      { appId: "ABC123", apiKey: "secret-key" },
      fetchFn,
    );

    expect(result.hits?.[0]).toEqual(grailedFixture.hits[0]);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://ABC123-dsn.algolia.net/1/indexes/Post_production/query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-algolia-application-id": "ABC123" }),
        body: JSON.stringify({ query: "corduroy jacket" }),
      }),
    );
  });

  it("throws with the HTTP status when the response is not ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    await expect(
      queryGrailedAlgolia({ query: "x" }, { appId: "ABC123", apiKey: "bad-key" }, fetchFn),
    ).rejects.toThrow("Grailed Algolia failed: 401");
  });
});
