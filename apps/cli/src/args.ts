import type { Platform } from "@fm/core/core/types.js";

export function parseRunArgs(argv: string[]): { configPath: string; platforms?: Platform[] } {
  let configPath = "config.yaml";
  let platforms: Platform[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config" && argv[i + 1]) {
      configPath = argv[++i];
    }
    if (argv[i] === "--platforms" && argv[i + 1]) {
      platforms = argv[++i].split(",").map((p) => p.trim()) as Platform[];
    }
  }

  return { configPath, platforms };
}

export function parseReportArgs(argv: string[]): { configPath: string; days: number } {
  let configPath = "config.yaml";
  let days = 14;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config" && argv[i + 1]) {
      configPath = argv[++i];
    }
    if (argv[i] === "--days" && argv[i + 1]) {
      days = parseInt(argv[++i], 10);
    }
  }

  return { configPath, days };
}

export function parseDashboardArgs(argv: string[]): { configPath: string; host: string; port: number } {
  let configPath = "config.yaml";
  let host = process.env.DASHBOARD_HOST ?? "127.0.0.1";
  let port = parseInt(process.env.DASHBOARD_PORT ?? "3030", 10);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config" && argv[i + 1]) configPath = argv[++i];
    if (argv[i] === "--host" && argv[i + 1]) host = argv[++i];
    if (argv[i] === "--port" && argv[i + 1]) port = parseInt(argv[++i], 10);
  }

  return { configPath, host, port };
}
