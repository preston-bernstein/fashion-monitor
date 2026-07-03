import type { FastifyInstance } from "fastify";
import type { Config } from "@fm/core/core/config.js";
import type { Db } from "@fm/core/storage/db.js";
import { buildApp, type WebAppOptions } from "../web/app.js";

export interface DashboardServerOptions {
  config: Config;
  db: Db;
  host?: string;
  port?: number;
  /** Cookie signing secret (sessions persist across restarts when stable). */
  sessionSecret?: string;
  /** Encryption key for secrets at rest; secrets editing disabled when absent. */
  secretsKey?: string;
  /** Secure cookies (set true when behind TLS). */
  cookieSecure?: boolean;
  rateLimitMax?: number;
  loginRateLimitMax?: number;
}

export interface DashboardServer {
  app: FastifyInstance;
  start(): Promise<void>;
  stop(): Promise<void>;
  host: string;
  port: number;
}

/**
 * Build the Fastify web app and expose a start/stop lifecycle. The historic
 * read-only routes (GET /, /api/dashboard, /api/health, static assets) are
 * preserved; auth + RBAC + CRUD are layered on by buildApp.
 */
export async function createDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServer> {
  const { config, db, host = "127.0.0.1", port = 3030 } = options;

  const appOptions: WebAppOptions = {
    db,
    fileConfig: config,
    databasePath: config.database.path,
    sessionSecret: options.sessionSecret,
    secretsKey: options.secretsKey,
    cookieSecure: options.cookieSecure,
    rateLimitMax: options.rateLimitMax,
    loginRateLimitMax: options.loginRateLimitMax,
  };

  const app = await buildApp(appOptions);

  return {
    app,
    async start(): Promise<void> {
      await app.listen({ host, port });
    },
    async stop(): Promise<void> {
      await app.close();
    },
    host,
    port,
  };
}
