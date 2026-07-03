import { describe, expect, it, afterEach } from "vitest";
import { navItemActive } from "./app-shell";

function setSearch(search: string) {
  window.history.pushState(null, "", `/whatever${search}`);
}

describe("navItemActive", () => {
  afterEach(() => {
    window.history.pushState(null, "", "/");
  });

  it("matches the root path exactly, not as a prefix", () => {
    expect(navItemActive("/", "/", undefined)).toBe(true);
    expect(navItemActive("/monitors", "/", undefined)).toBe(false);
  });

  it("matches a tab-scoped item only when both the path prefix and ?tab= agree", () => {
    setSearch("?tab=active");
    expect(navItemActive("/monitors", "/monitors", { tab: "active" })).toBe(true);
    expect(navItemActive("/monitors", "/monitors", { tab: "paused" })).toBe(false);

    setSearch("");
    expect(navItemActive("/monitors", "/monitors", { tab: "active" })).toBe(false);
  });

  it("treats /system as active only when the tab isn't 'secrets' (that's a separate nav item)", () => {
    setSearch("");
    expect(navItemActive("/system", "/system", undefined)).toBe(true);

    setSearch("?tab=secrets");
    expect(navItemActive("/system", "/system", undefined)).toBe(false);

    setSearch("?tab=llm");
    expect(navItemActive("/system", "/system", undefined)).toBe(true);
  });

  it("falls back to a plain prefix match for ordinary nav items", () => {
    expect(navItemActive("/audit", "/audit", undefined)).toBe(true);
    expect(navItemActive("/audit/123", "/audit", undefined)).toBe(true);
    expect(navItemActive("/analytics", "/audit", undefined)).toBe(false);
  });
});
