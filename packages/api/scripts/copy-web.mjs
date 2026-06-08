import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const webDist = join(root, "..", "..", "..", "apps", "web", "dist");
const publicDir = join(root, "..", "dist", "public");

if (!existsSync(webDist)) {
  console.warn("@fm/api#build: apps/web/dist not found — skipping SPA copy (backend-only run)");
  process.exit(0);
}

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(webDist, publicDir, { recursive: true });
