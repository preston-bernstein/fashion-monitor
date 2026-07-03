import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";
import type { OnboardingResponse } from "@fm/shared/dto.js";

describe("onboarding checklist dismissal", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("defaults to not dismissed", async () => {
    await createUser(db, "viewer@example.com", "pw-viewer-123", "viewer");
    const client = new TestClient(app);
    await client.login("viewer@example.com", "pw-viewer-123");
    const res = await client.get("/api/onboarding");
    expect(res.statusCode).toBe(200);
    expect((res.json() as OnboardingResponse).dismissed).toBe(false);
  });

  it("persists dismissal per profile", async () => {
    await createUser(db, "owner1@example.com", "pw-owner1-123", "owner", "p1");
    await createUser(db, "owner2@example.com", "pw-owner2-123", "owner", "p2");

    const client1 = new TestClient(app);
    await client1.login("owner1@example.com", "pw-owner1-123");
    const dismissRes = await client1.post("/api/onboarding/dismiss");
    expect(dismissRes.statusCode).toBe(200);

    const afterDismiss = await client1.get("/api/onboarding");
    expect((afterDismiss.json() as OnboardingResponse).dismissed).toBe(true);

    const client2 = new TestClient(app);
    await client2.login("owner2@example.com", "pw-owner2-123");
    const otherProfile = await client2.get("/api/onboarding");
    expect((otherProfile.json() as OnboardingResponse).dismissed).toBe(false);
  });
});
