import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const migrationsSrc = join(root, "..", "src", "storage", "migrations");
const migrationsDst = join(root, "..", "dist", "storage", "migrations");

mkdirSync(migrationsDst, { recursive: true });
cpSync(migrationsSrc, migrationsDst, { recursive: true });
