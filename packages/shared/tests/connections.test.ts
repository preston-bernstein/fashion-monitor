import { describe, expect, it } from "vitest";
import { CONNECTIONS, findConnection } from "../src/connections.js";

describe("findConnection", () => {
  it("finds a known platform's connection metadata", () => {
    expect(findConnection("ebay")).toMatchObject({
      platform: "ebay",
      label: "eBay",
      type: "api-key",
    });
  });

  it("returns undefined for an unknown platform", () => {
    expect(findConnection("not-a-real-platform")).toBeUndefined();
  });
});

describe("CONNECTIONS", () => {
  it("has no duplicate platform entries", () => {
    const platforms = CONNECTIONS.map((c) => c.platform);
    expect(new Set(platforms).size).toBe(platforms.length);
  });

  it("marks every login-type connection as dormant (ADR-0004's ToS gate)", () => {
    for (const c of CONNECTIONS) {
      if (c.type === "login") expect(c.dormant).toBe(true);
    }
  });

  it("marks every non-login connection as not dormant", () => {
    for (const c of CONNECTIONS) {
      if (c.type !== "login") expect(c.dormant).toBe(false);
    }
  });
});
