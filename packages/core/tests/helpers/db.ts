import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../../src/core/config.js";
import { openDatabase } from "../../src/storage/db.js";
import type { Db } from "../../src/storage/db.js";
import { minimalConfig } from "./fixtures.js";

export function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function createMemoryDb(): { db: Db; config: Config } {
  return { db: openDatabase(":memory:"), config: minimalConfig };
}

export function createTestDb(prefix: string): {
  dbPath: string;
  db: Db;
  config: Config;
} {
  const dbPath = join(createTempDir(prefix), "test.db");
  const config: Config = {
    ...minimalConfig,
    database: { path: dbPath },
  };
  return { dbPath, db: openDatabase(dbPath), config };
}

export function poshmarkLiveConfig(): Config {
  return {
    ...minimalConfig,
    scraper: { poshmark_profile_path: createTempDir("fm-poshmark-live-") },
  };
}
