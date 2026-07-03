---
name: fashion-monitor-build-and-env
description: Recreate the fashion-monitor dev environment from scratch and avoid its build traps — Node 24, pnpm 9.15 workspace, Turborepo build order, Playwright chromium install, better-sqlite3 native rebuilds, TypeScript NodeNext vs bundler modes, Docker turbo-prune images. Load when setting up a fresh clone, when `pnpm install`/`pnpm run build`/`pnpm test` fails, when typecheck breaks on stale dist, or when building the Docker images. Do NOT load for running the pipeline or deploying to the NAS (fashion-monitor-run-and-operate) or for config.yaml/.env semantics (fashion-monitor-config-and-flags).
---

# Fashion Monitor — Build & Environment

Everything here was verified against the repo on 2026-07-02. Vocabulary (Monitor, Taste, Profile, ...) is defined in `CONTEXT.md` at the repo root.

## Toolchain requirements (as of 2026-07-02)

| Tool | Required | Where declared | Check |
|---|---|---|---|
| Node | `>= 24` | root `package.json` `engines.node` | `node --version` |
| pnpm | `9.15.0` (pinned) | root `package.json` `packageManager` field | `pnpm --version` after `corepack enable` |
| corepack | any recent | ships with Node 24 | `corepack --version` |
| turbo | `^2.5.4` | root devDependency (not global) | `pnpm exec turbo --version` |

pnpm is NOT assumed to be globally installed. The supported path is corepack: `corepack enable`, then any `pnpm` invocation inside the repo resolves the version pinned in `packageManager` (9.15.0). Note: the Dockerfiles run `corepack prepare pnpm@10.12.1 --activate` — a version mismatch with the root pin; inside the project directory corepack should still honor the `packageManager` field, but treat the Docker pnpm version as 9.15.0-per-pin / 10.12.1-per-prepare, unverified which wins at image-build time.

pnpm only warns (does not hard-fail) on an `engines` mismatch by default. Node 20 will appear to work until native modules and `@types/node` 24 break you — see traps.

## From-scratch checklist (fresh clone)

Run at the repo root, in order:

```bash
# 1. Node >= 24 (repo verified on v24.16.0)
node --version

# 2. Activate the pinned pnpm via corepack
corepack enable
pnpm --version        # must print 9.15.0

# 3. Single workspace install at the ROOT. Never npm/yarn. Never per-package installs.
pnpm install

# 4. Local config + secrets (both files are gitignored)
cp config.example.yaml config.yaml
cp .env.example .env   # then fill in tokens; see fashion-monitor-config-and-flags

# 5. Playwright chromium (needed for e2e tests, Depop fallback, Poshmark)
pnpm exec playwright install chromium

# 6. Full build (Turborepo, topological)
pnpm run build

# 7. Tests
pnpm test
```

Notes on step 5 — the docs disagree with each other:

- `docs/SMOKE.md` says `node node_modules/playwright/cli.js install chromium`. That FAILS at the repo root in this pnpm workspace: `playwright` is a dependency of `@fm/core`, not of the root, so `node_modules/playwright` does not exist at the root (verified). It works only from inside `packages/core/`.
- `pnpm exec playwright install chromium` at the root works because the root devDependency `@playwright/test` provides the `playwright` bin in `node_modules/.bin/` (verified present).
- `@fm/core` also has `"postinstall": "playwright install chromium || true"` — so `pnpm install` usually installs chromium for you automatically. The `|| true` swallows failures silently, so if e2e later can't find chromium, run step 5 explicitly.

## Workspace layout and build graph

`pnpm-workspace.yaml` globs: `packages/*`, `apps/*`, `services/*`. It also defines a **`catalog:`** — shared versions for `react`, `react-dom`, `zod`, `typescript`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `@types/node`, `@vitest/coverage-v8`. Workspace package.jsons reference these as `"zod": "catalog:"`. When bumping one of these, edit the catalog, not the individual packages.

| Package | Name | Build script | Depends on |
|---|---|---|---|
| `packages/shared` | `@fm/shared` | `tsc` | zod |
| `packages/core` | `@fm/core` | `tsc && node scripts/copy-migrations.mjs` | @fm/shared |
| `packages/api` | `@fm/api` | `tsc && node scripts/copy-web.mjs` | @fm/core, @fm/shared |
| `apps/web` | `@fm/web` | `vite build` | @fm/shared only (HTTP at runtime) |
| `apps/cli` | `@fm/cli` | `tsc` | @fm/core, @fm/api |
| `services/mcp-server` | `@fm/mcp-server` | `tsc` | @fm/core, @fm/shared |

`turbo.json` (root) rules, verified:

- `build` `dependsOn: ["^build"]`, `outputs: ["dist/**"]` — topological: shared → core → web/api → cli.
- **`@fm/api#build` additionally `dependsOn: ["@fm/web#build"]`** even though api does not import web: `packages/api/scripts/copy-web.mjs` copies `apps/web/dist` into `packages/api/dist/public` so Fastify can serve the SPA. If `apps/web/dist` is missing it warns and skips (backend-only build still succeeds).
- `typecheck` `dependsOn: ["^build"]` — typecheck needs upstream `dist/` to exist.
- `test` `dependsOn: ["build"]` — a package's own build (and transitively `^build`) runs before its tests.

Build side effects that must exist at runtime: `@fm/core` copies `src/storage/migrations/*.sql` to `dist/storage/migrations/` (the migration runner resolves SQL next to compiled `db.js` — do not "clean up" this layout; `docs/plans/stack-modernization.md` §12 forbids changing it).

## Traps

| Trap | Symptom | Why / fix |
|---|---|---|
| Using npm or yarn | `npm ci` fails: no `package-lock.json`; or `npm install` creates a rogue lockfile and a broken hoisted tree | Repo is a pnpm workspace; `.gitignore` ignores `**/package-lock.json`. Evidence this bites for real: `.github/workflows/ci.yml` and `live-smoke.yml` still run `setup-node` with `node-version: "20"` + `cache: npm` + `npm ci` — **CI is broken as written** (known weak point; fixing it is a change-control matter, see fashion-monitor-change-control). Always `pnpm install` at the root. |
| Node 20 (or any < 24) | Works until it doesn't: `@types/node` 24 type errors, native-module ABI mismatches, subtle runtime gaps | `engines.node: ">=24"`; pnpm only warns. Use Node 24 LTS (`node --version`). Docker base is `node:24-bookworm`. |
| Missing chromium | `pnpm run test:e2e` fails to launch browser; Depop Playwright fallback and Poshmark scrapes fail | e2e (`tests/e2e/poshmark-fixture.spec.ts`, per `playwright.config.ts`) and two platforms need chromium. `pnpm exec playwright install chromium` at root. Do not trust SMOKE.md's `node node_modules/playwright/cli.js ...` form at the root (see above). |
| better-sqlite3 after Node switch | `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch on import of `better-sqlite3` | Native addon compiled per Node ABI. After changing Node majors: `pnpm rebuild better-sqlite3` (also `pnpm rebuild argon2` — @fm/api's other native dep), or wipe `node_modules` and `pnpm install`. |
| `.js` import suffixes (backend) | `tsc` "Relative import paths need explicit file extensions" or Node `ERR_MODULE_NOT_FOUND` at runtime | Backend packages use TS 6 `module: NodeNext` (tsconfig.base.json): every relative import must end `.js` even though the source is `.ts` (e.g. `from "../core/config.js"`). `apps/web` is different: `moduleResolution: "bundler"`, no suffixes, and its tsconfig `paths` maps `@fm/shared` straight to `packages/shared/src`. Do not copy import style between the two worlds. Removing `.js` suffixes or switching backend to bundler resolution is explicitly forbidden (stack-modernization §12). |
| Stale turbo cache | Build "succeeds" instantly but dist is wrong / edits seem ignored | Turbo caches task outputs in `.turbo/` (gitignored). Force a real run with `pnpm exec turbo run build --force`, or delete `.turbo/`. |
| `apps/web` has its own `node_modules` | Confusion when nuking installs; deleting only root `node_modules` leaves stale per-package trees | Normal pnpm behavior: every workspace package gets a `node_modules` of symlinks into the store. To fully reset: `rm -rf node_modules */*/node_modules .turbo && pnpm install` (or `git clean -fdx -e .env -e config.yaml -e data` — careful, destructive). |
| Stale dist breaks typecheck | `pnpm run typecheck` errors in a package you didn't touch, pointing into `dist/*.d.ts` | `typecheck` dependsOn `^build`: it type-checks against upstream compiled declarations. If `@fm/shared` / `@fm/core` dist is stale, rebuild first: `pnpm run build`, then typecheck. When in doubt: `pnpm exec turbo run build --force`. |
| Per-package installs | `cd packages/core && npm install` corrupts the workspace | All deps are installed once from the root. To add a dep to one package: `pnpm --filter @fm/core add <pkg>` from the root. |

## Docker images (two of them)

The Makefile `build` target (verified) builds both images for `linux/amd64` (the Synology NAS arch) via buildx `--load`:

- `fashion-monitor/cli` from root `Dockerfile` (pipeline + entrypoints, includes chromium via `pnpm exec playwright install --with-deps chromium`)
- `fashion-monitor/mcp-server` from `services/mcp-server/Dockerfile` (CMD `node services/mcp-server/dist/index.js`)

Both Dockerfiles follow the same verified pattern:

1. `FROM node:24-bookworm` + corepack + `apt-get install python3 make g++ libsqlite3-dev` (native-addon toolchain for better-sqlite3/argon2).
2. **Pruner stage:** `pnpm dlx turbo@2.5.4 prune @fm/cli --docker` (or `@fm/mcp-server`) — produces `out/json` (manifests only, for a cacheable `pnpm install --frozen-lockfile`) and `out/full` (sources).
3. **Builder stage quirk:** a `node -e` one-liner DELETES the `@fm/api#build` task override from the pruned `turbo.json`. Why: that override depends on `@fm/web#build`, but `@fm/web` is not a package.json dependency of `@fm/api`, so `turbo prune` excludes it from the pruned workspace and the dangling task reference would break the build. If you change turbo.json task names, update this surgery line in BOTH Dockerfiles.
4. Runner stage copies `node_modules` + built packages; `VOLUME ["/data"]`.

Build locally with `make build` (or the two `docker buildx build --platform linux/amd64 ...` commands inside it). Deploy/push/sync are fashion-monitor-run-and-operate territory. The NAS host/user/path are Makefile variables (`NAS_HOST`, `NAS_USER`, `NAS_PATH`) — do not hardcode them anywhere.

Known doc/tree drift (as of 2026-07-02): the Makefile `sync` target still echoes `TELEGRAM_*` env hints while the working tree is mid Telegram→ntfy migration (orchestrator already imports `createNtfyAlerter`), and `.env.example` still lists `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`. See fashion-monitor-failure-archaeology and fashion-monitor-alerting-feedback-campaign before "fixing" either.

## Stack versions (from README §Stack, date-stamped mid-2026)

| Area | Target |
|---|---|
| Node | >= 24 LTS (Docker `node:24-bookworm`) |
| TypeScript | 6.0 (NodeNext backend, bundler SPA) |
| Zod | 4.4 (shared across api + web via catalog) |
| Vitest / ESLint | 4.x / 10.x |
| Playwright | 1.52.x (+ stealth pilot doc) |
| better-sqlite3 | 12.x |
| Anthropic SDK | ~0.102 |
| Fastify | >= 5.8.5 (5.8.5 is a CVE fix — keep lockfile at or above) |

**Upgrade governance:** `docs/plans/stack-modernization.md` is the ruling document for any version bump. Its §12 "Explicitly do NOT change" list (extracted verbatim intent, verified):

- Do NOT adopt `node:sqlite` — keep better-sqlite3 12.
- Do NOT remove `.js` import extensions on the backend.
- Do NOT switch the backend to `moduleResolution: bundler`.
- Do NOT downgrade or rewrite the frontend (React 19 / Vite 8 / Tailwind 4 / TanStack / shadcn are current).
- Do NOT replace the Fastify auth/session/RBAC design or move to Redis sessions.
- Do NOT replace ESLint with Biome wholesale (Oxlint may be added alongside only).
- Do NOT introduce an ORM or migration framework — keep hand-rolled idempotent SQL migrations, and preserve the `migrations/`-next-to-`db.js` runtime layout.
- Do NOT change deployment topology (Caddy + docker-compose) as part of modernization.

Also honor `docs/playwright-stealth-pilot.md`'s "do not remove yet" fence on `playwright-extra` + `puppeteer-extra-plugin-stealth`.

## Common commands (all from repo root, all verified in root package.json)

```bash
pnpm run build            # turbo, topological
pnpm test                 # turbo: vitest per package (no network)
pnpm run typecheck        # turbo (builds upstream first)
pnpm run lint             # turbo: eslint per package
pnpm run format:check     # prettier check
pnpm run test:e2e         # Playwright DOM fixture (needs chromium)
pnpm run test:coverage    # @fm/core coverage
pnpm run test:mutation    # Stryker on @fm/core (slow)
pnpm --filter @fm/core add <pkg>   # add a dep to one package
```

Live-network commands (`test:live`, `verify:scrapers`) and dev entrypoints (`dev:run`, `dev:web`, `dev:dashboard`) exist but belong to fashion-monitor-run-and-operate / fashion-monitor-validation-and-qa; during development prefer fixtures over live scrapes (assumed rule — confirm with owner).

## When NOT to use this skill

- Running the pipeline, dev servers, Docker deploy to the NAS, data/artifact paths → **fashion-monitor-run-and-operate**.
- What goes in `config.yaml` / `.env` / DB-backed settings and their authority order → **fashion-monitor-config-and-flags**.
- Test taxonomy, fixtures, evidence standards → **fashion-monitor-validation-and-qa**.
- Whether a toolchain/dependency change is even allowed → **fashion-monitor-change-control**.

## Provenance and maintenance

Verified 2026-07-02 by reading files and read-only shell checks (no installs/builds executed). Re-verify before trusting:

- Node/pnpm pins: `grep -A2 '"engines"' package.json && grep packageManager package.json`
- Catalog + workspace globs: `cat pnpm-workspace.yaml`
- Turbo graph incl. `@fm/api#build` override: `cat turbo.json`
- Backend TS mode: `grep -E 'module|moduleResolution' tsconfig.base.json`; SPA mode: `grep moduleResolution apps/web/tsconfig.app.json`
- Chromium postinstall hook: `grep postinstall packages/core/package.json`
- Playwright bin at root: `ls node_modules/.bin/playwright` (from @playwright/test); absence of root `node_modules/playwright`: `ls node_modules/playwright`
- CI still broken on npm/Node 20: `grep -E 'node-version|npm ci|cache' .github/workflows/ci.yml .github/workflows/live-smoke.yml`
- Docker pnpm version + turbo.json surgery: `grep -nE 'corepack prepare|turbo@|delete t.tasks' Dockerfile services/mcp-server/Dockerfile`
- Image names / platform: `grep -nE 'PLATFORM|buildx' Makefile`
- Do-NOT list still current: `sed -n '/## 12/,/## 13/p' docs/plans/stack-modernization.md`
- Stack table: README `## Stack (mid-2026)` section
