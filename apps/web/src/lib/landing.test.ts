import { describe, expect, it } from "vitest";
import { defaultLandingForRole, homePathForRole } from "./landing";
import type { Role } from "@fm/shared/dto.js";

describe("defaultLandingForRole", () => {
  it("lands viewers on analytics", () => {
    expect(defaultLandingForRole("viewer")).toBe("/");
  });

  it("lands operators on system", () => {
    expect(defaultLandingForRole("operator")).toBe("/system");
  });

  it("lands curators, admins, and owners on monitors", () => {
    expect(defaultLandingForRole("curator")).toBe("/monitors");
    expect(defaultLandingForRole("admin")).toBe("/monitors");
    expect(defaultLandingForRole("owner")).toBe("/monitors");
  });

  it("falls back to analytics for an unrecognized role", () => {
    expect(defaultLandingForRole("something-else" as Role)).toBe("/");
  });
});

describe("homePathForRole", () => {
  it("matches defaultLandingForRole for every role", () => {
    const roles: Role[] = ["viewer", "operator", "curator", "admin", "owner"];
    for (const role of roles) {
      expect(homePathForRole(role)).toBe(defaultLandingForRole(role));
    }
  });
});
