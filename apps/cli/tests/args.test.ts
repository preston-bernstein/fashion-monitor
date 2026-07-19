import { describe, expect, it, afterEach } from "vitest";
import { parseRunArgs, parseReportArgs, parseEvalArgs, parseDashboardArgs } from "../src/args.js";

describe("parseRunArgs", () => {
  it("defaults to config.yaml with no platform filter", () => {
    expect(parseRunArgs([])).toEqual({ configPath: "config.yaml", platforms: undefined });
  });

  it("parses --config", () => {
    expect(parseRunArgs(["--config", "custom.yaml"])).toEqual({
      configPath: "custom.yaml",
      platforms: undefined,
    });
  });

  it("parses a comma-separated --platforms list, trimming whitespace", () => {
    expect(parseRunArgs(["--platforms", "ebay, grailed,depop"])).toEqual({
      configPath: "config.yaml",
      platforms: ["ebay", "grailed", "depop"],
    });
  });

  it("ignores a flag with no following value", () => {
    expect(parseRunArgs(["--config"])).toEqual({ configPath: "config.yaml", platforms: undefined });
  });
});

describe("parseReportArgs", () => {
  it("defaults to config.yaml and 14 days", () => {
    expect(parseReportArgs([])).toEqual({ configPath: "config.yaml", days: 14 });
  });

  it("parses --config and --days", () => {
    expect(parseReportArgs(["--config", "c.yaml", "--days", "30"])).toEqual({
      configPath: "c.yaml",
      days: 30,
    });
  });
});

describe("parseEvalArgs", () => {
  it("defaults everything but configPath to undefined", () => {
    expect(parseEvalArgs([])).toEqual({
      configPath: "config.yaml",
      revisionId: undefined,
      provider: undefined,
      limit: undefined,
    });
  });

  it("parses --revision, --provider, and --limit", () => {
    expect(parseEvalArgs(["--revision", "7", "--provider", "claude", "--limit", "50"])).toEqual({
      configPath: "config.yaml",
      revisionId: 7,
      provider: "claude",
      limit: 50,
    });
  });
});

describe("parseDashboardArgs", () => {
  const originalHost = process.env.DASHBOARD_HOST;
  const originalPort = process.env.DASHBOARD_PORT;

  afterEach(() => {
    if (originalHost === undefined) delete process.env.DASHBOARD_HOST;
    else process.env.DASHBOARD_HOST = originalHost;
    if (originalPort === undefined) delete process.env.DASHBOARD_PORT;
    else process.env.DASHBOARD_PORT = originalPort;
  });

  it("defaults host/port from env vars, falling back to 127.0.0.1:3030", () => {
    delete process.env.DASHBOARD_HOST;
    delete process.env.DASHBOARD_PORT;
    expect(parseDashboardArgs([])).toEqual({
      configPath: "config.yaml",
      host: "127.0.0.1",
      port: 3030,
    });
  });

  it("prefers DASHBOARD_HOST/DASHBOARD_PORT env vars over the hardcoded default", () => {
    process.env.DASHBOARD_HOST = "0.0.0.0";
    process.env.DASHBOARD_PORT = "8080";
    expect(parseDashboardArgs([])).toEqual({
      configPath: "config.yaml",
      host: "0.0.0.0",
      port: 8080,
    });
  });

  it("CLI flags override env vars", () => {
    process.env.DASHBOARD_HOST = "0.0.0.0";
    process.env.DASHBOARD_PORT = "8080";
    expect(parseDashboardArgs(["--host", "10.0.0.1", "--port", "9999"])).toEqual({
      configPath: "config.yaml",
      host: "10.0.0.1",
      port: 9999,
    });
  });
});
