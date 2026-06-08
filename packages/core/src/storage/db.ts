import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

function columnExists(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

const COLUMN_PATCHES: Array<{ table: string; column: string; ddl: string }> = [
  {
    table: "seen_listings",
    column: "source_query_id",
    ddl: "ALTER TABLE seen_listings ADD COLUMN source_query_id TEXT",
  },
  {
    table: "alert_log",
    column: "source_query_id",
    ddl: "ALTER TABLE alert_log ADD COLUMN source_query_id TEXT",
  },
  {
    table: "feedback",
    column: "source_query_id",
    ddl: "ALTER TABLE feedback ADD COLUMN source_query_id TEXT",
  },
  {
    table: "config_revisions",
    column: "changed_by_user_id",
    ddl: "ALTER TABLE config_revisions ADD COLUMN changed_by_user_id INTEGER",
  },
];

function applyColumnPatches(db: Db): void {
  for (const patch of COLUMN_PATCHES) {
    if (!columnExists(db, patch.table, patch.column)) {
      db.exec(patch.ddl);
    }
  }
}

export function migrate(db: Db): void {
  const migrationsDir = join(__dirname, "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (
      file === "002_listing_snapshot.sql" &&
      columnExists(db, "seen_listings", "listing_snapshot")
    ) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    try {
      db.exec(sql);
    } catch (err) {
      if (
        file === "002_listing_snapshot.sql" &&
        columnExists(db, "seen_listings", "listing_snapshot")
      ) {
        continue;
      }
      throw err;
    }
  }

  applyColumnPatches(db);
}

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function closeDatabase(db: Db): void {
  db.close();
}
