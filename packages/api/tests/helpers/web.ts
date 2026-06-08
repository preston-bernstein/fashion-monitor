import type { FastifyInstance, InjectOptions } from "fastify";
import type { LightMyRequestResponse } from "fastify";
import { buildApp, type WebAppOptions } from "../../src/web/app.js";
import { bootstrapAdmin, hashPassword } from "../../src/web/auth.js";
import { UsersRepo, MembershipsRepo } from "@fm/core/storage/repos/users.js";
import type { Db } from "@fm/core/storage/db.js";
import type { Role } from "@fm/shared/rbac.js";
import { minimalConfig } from "./fixtures.js";

export const TEST_SESSION_SECRET = "test-session-secret-0123456789abcdef";
export const TEST_SECRETS_KEY = "a".repeat(64);

export async function buildTestApp(
  db: Db,
  overrides: Partial<WebAppOptions> = {},
): Promise<FastifyInstance> {
  return buildApp({
    db,
    profileId: "default",
    fileConfig: minimalConfig,
    databasePath: ":memory:",
    sessionSecret: TEST_SESSION_SECRET,
    secretsKey: TEST_SECRETS_KEY,
    rateLimitMax: 100000,
    loginRateLimitMax: 100000,
    ...overrides,
  });
}

export async function createUser(
  db: Db,
  email: string,
  password: string,
  role: Role,
  profileId = "default",
): Promise<number> {
  const now = new Date().toISOString();
  const users = new UsersRepo(db);
  const id = users.findByEmail(email)?.id ?? users.create(email, await hashPassword(password), now);
  new MembershipsRepo(db).upsert(id, profileId, role, now);
  return id;
}

export async function seedAdmin(
  db: Db,
  email = "admin@example.com",
  password = "admin-password-123",
): Promise<void> {
  await bootstrapAdmin(db, "default", email, password, new Date().toISOString());
}

export class TestClient {
  private jar = new Map<string, string>();
  private csrfToken?: string;

  constructor(private readonly app: FastifyInstance) {}

  private cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private store(res: LightMyRequestResponse): void {
    for (const c of res.cookies as Array<{ name: string; value: string }>) {
      this.jar.set(c.name, c.value);
    }
  }

  async inject(opts: InjectOptions): Promise<LightMyRequestResponse> {
    const headers = { ...(opts.headers ?? {}) };
    const cookie = this.cookieHeader();
    if (cookie) (headers as Record<string, string>).cookie = cookie;
    const res = await this.app.inject({ ...opts, headers });
    this.store(res);
    return res;
  }

  get(url: string): Promise<LightMyRequestResponse> {
    return this.inject({ method: "GET", url });
  }

  async csrf(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const res = await this.get("/api/csrf");
    this.csrfToken = (res.json() as { csrfToken: string }).csrfToken;
    return this.csrfToken;
  }

  async send(
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    body?: unknown,
  ): Promise<LightMyRequestResponse> {
    const token = await this.csrf();
    const headers: Record<string, string> = { "x-csrf-token": token };
    if (body !== undefined) headers["content-type"] = "application/json";
    return this.inject({
      method,
      url,
      headers,
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  post(url: string, body?: unknown): Promise<LightMyRequestResponse> {
    return this.send("POST", url, body);
  }
  put(url: string, body?: unknown): Promise<LightMyRequestResponse> {
    return this.send("PUT", url, body);
  }
  patch(url: string, body?: unknown): Promise<LightMyRequestResponse> {
    return this.send("PATCH", url, body);
  }
  del(url: string, body?: unknown): Promise<LightMyRequestResponse> {
    return this.send("DELETE", url, body);
  }

  async login(email: string, password: string): Promise<LightMyRequestResponse> {
    return this.post("/api/login", { email, password });
  }

  async logout(): Promise<LightMyRequestResponse> {
    return this.post("/api/logout");
  }
}
