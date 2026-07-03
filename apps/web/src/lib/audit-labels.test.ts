import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  auditActionSeverity,
  isMonitorTarget,
  isUserTarget,
} from "./audit-labels";

describe("auditActionLabel", () => {
  it("maps a known action to its human label", () => {
    expect(auditActionLabel("user.create")).toBe("User created");
    expect(auditActionLabel("login.failed")).toBe("Login failed");
  });

  it("falls back to dot-replaced text for an unknown action", () => {
    expect(auditActionLabel("some.unmapped.action")).toBe("some · unmapped · action");
  });
});

describe("auditActionSeverity", () => {
  it("flags login/auth failures as danger", () => {
    expect(auditActionSeverity("login.failed")).toBe("danger");
    expect(auditActionSeverity("auth.forbidden")).toBe("danger");
    expect(auditActionSeverity("auth.csrf.failed")).toBe("danger");
  });

  it("treats everything else as default severity", () => {
    expect(auditActionSeverity("login.success")).toBe("default");
    expect(auditActionSeverity("user.create")).toBe("default");
  });
});

describe("isMonitorTarget", () => {
  it("is true only for search_group.* actions with a target", () => {
    expect(isMonitorTarget("search_group.create", "corduroy-jacket")).toBe(true);
    expect(isMonitorTarget("search_group.delete", "corduroy-jacket")).toBe(true);
  });

  it("is false without a target, or for a non-search_group action", () => {
    expect(isMonitorTarget("search_group.create", null)).toBe(false);
    expect(isMonitorTarget("user.create", "corduroy-jacket")).toBe(false);
  });
});

describe("isUserTarget", () => {
  it("is true only for user.* actions whose target looks like an email", () => {
    expect(isUserTarget("user.create", "someone@example.com")).toBe(true);
    expect(isUserTarget("user.role", "someone@example.com")).toBe(true);
  });

  it("is false without a target, for a non-user action, or a non-email target", () => {
    expect(isUserTarget("user.create", null)).toBe(false);
    expect(isUserTarget("search_group.create", "someone@example.com")).toBe(false);
    expect(isUserTarget("user.create", "not-an-email")).toBe(false);
  });
});
